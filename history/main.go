// asn-history: the routing history behind asn.1ms.dog. Once a day it reads who announces what, as RIPE NCC's route
// collectors see it (RIS riswhoisdump, the same files and the same rule as scripts/data.mjs: a prefix counts when at
// least 10 RIS peers see it), and the RPKI ROAs (rpki-client's VRP export), compares them with the last run and keeps
// only what changed:
//
//   - every (prefix, origin AS) as intervals of days it was announced, so the day a prefix appeared or went away;
//   - the RPKI state of each announced route (valid, invalid, not found, RFC 6811) and the day it last changed;
//   - each AS's IPv4 and IPv6 prefix counts, a point on each day they changed.
//
// It writes one JSON file per AS into -out (as/<asn>.json, see history/README.md) and meta.json; the asn.1ms.dog Worker
// fetches them. The state is one file in -state (state.bin.gz). Every file is written to a temporary name and renamed
// over the old one, so a reader never sees half a file. Only errors are printed; the run's figures go into meta.json.
//
// Memory (the server gives it 200 MB): today's routes are read and checked against the VRPs first, the VRPs are let
// go, and only then is the history loaded and merged; the state is streamed in and out, never held encoded.
package main

import (
	"bufio"
	"compress/gzip"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	seen    = 10  // RIS peers that must see a prefix (scripts/data.mjs SEEN)
	keep    = 730 // days a route that went away stays in the history
	series  = 400 // days of prefix-count points kept
	events  = 60  // the latest appeared / went-away events in an AS file
	version = 1   // of the state file
)

var sources = map[string]string{
	"ris4": "https://www.ris.ripe.net/dumps/riswhoisdump.IPv4.gz",
	"ris6": "https://www.ris.ripe.net/dumps/riswhoisdump.IPv6.gz",
	"vrp":  "https://rpki.cloudflare.com/rpki.json",
}

// A prefix is the family, its first 64 bits (IPv4: the address in the top 32 bits) and its length. IPv6 prefixes
// longer than /64 are left out: none is seen by 10 RIS peers.
type Pfx struct {
	Hi  uint64
	Len uint8
	V6  bool
}

func (p Pfx) less(q Pfx) bool {
	if p.V6 != q.V6 {
		return !p.V6
	}
	if p.Hi != q.Hi {
		return p.Hi < q.Hi
	}
	return p.Len < q.Len
}

func (p Pfx) String() string {
	if !p.V6 {
		var b [4]byte
		binary.BigEndian.PutUint32(b[:], uint32(p.Hi>>32))
		return netip.PrefixFrom(netip.AddrFrom4(b), int(p.Len)).String()
	}
	var b [16]byte
	binary.BigEndian.PutUint64(b[:8], p.Hi)
	return netip.PrefixFrom(netip.AddrFrom16(b), int(p.Len)).String()
}

func mask(l uint8) uint64 {
	if l == 0 {
		return 0
	}
	return ^uint64(0) << (64 - l)
}

func parsePfx(s string) (Pfx, bool) {
	p, err := netip.ParsePrefix(s)
	if err != nil {
		return Pfx{}, false
	}
	p = p.Masked()
	a := p.Addr()
	if a.Is4() {
		b := a.As4()
		return Pfx{uint64(binary.BigEndian.Uint32(b[:])) << 32, uint8(p.Bits()), false}, true
	}
	if a.Is4In6() || p.Bits() > 64 {
		return Pfx{}, false
	}
	b := a.As16()
	return Pfx{binary.BigEndian.Uint64(b[:8]), uint8(p.Bits()), true}, true
}

// RPKI states
const (
	notFound = 0
	valid    = 1
	invalid  = 2
)

var rpkiCode = [...]string{"n", "v", "i"}

// One interval of days an origin AS announced a prefix. Days count from 1970-01-01. The prefix is spelled out in the
// fields (24 bytes a route, not 32 with a Pfx inside): there are 1.4 million of them.
type Route struct {
	Hi     uint64
	AS     uint32
	First  uint16
	Last   uint16
	RSince uint16 // the first day of its RPKI state while announced
	Len    uint8
	Flags  uint8 // 1: IPv6; its RPKI state on Last << 1
}

func (r Route) P() Pfx           { return Pfx{r.Hi, r.Len, r.Flags&1 == 1} }
func (r Route) RPKI() uint8      { return r.Flags >> 1 }
func (r *Route) setRPKI(s uint8) { r.Flags = r.Flags&1 | s<<1 }

// A route as read today: the prefix, the origin and its RPKI state (16 bytes)
type Ann struct {
	Hi    uint64
	AS    uint32
	Len   uint8
	Flags uint8 // as in Route
}

func (a Ann) P() Pfx { return Pfx{a.Hi, a.Len, a.Flags&1 == 1} }

// compares a route of the history with one of today: prefix, then origin
func cmp(r Route, a Ann) int {
	if rp, ap := r.P(), a.P(); rp != ap {
		if rp.less(ap) {
			return -1
		}
		return 1
	}
	switch {
	case r.AS < a.AS:
		return -1
	case r.AS > a.AS:
		return 1
	}
	return 0
}

func annLess(a, b Ann) bool {
	if pa, pb := a.P(), b.P(); pa != pb {
		return pa.less(pb)
	}
	return a.AS < b.AS
}

type Point struct {
	Day    uint16
	N4, N6 uint32
}

type State struct {
	Version        int
	Since, LastRun uint16
	Routes         []Route // sorted by prefix, origin, First
	Counts         map[uint32][]Point
}

type VRP struct { // 16 bytes; about a million of them
	Hi       uint64
	AS       uint32
	Len, Max uint8
	V6       bool
}

func (v VRP) P() Pfx { return Pfx{v.Hi, v.Len, v.V6} }

type Meta struct {
	Since  string `json:"since"`  // the first day of the history
	Day    string `json:"day"`    // the day of the last run
	At     string `json:"at"`     // when it finished
	RIS    string `json:"ris"`    // when RIS generated the dumps read
	VRPAt  string `json:"vrp_at"` // when rpki-client built the VRPs read
	Routes int    `json:"routes"` // announced (prefix, origin) pairs today
	Added  int    `json:"added"`  // of them, not announced on the last run
	Gone   int    `json:"gone"`   // announced on the last run, not today
	Kept   int    `json:"kept"`   // intervals in the history (what the memory grows with)
	VRPs   int    `json:"vrps"`
	ASes   int    `json:"ases"` // AS files written
	Took   string `json:"took"`
	PeakMB int    `json:"peak_mb"`
}

func day(t time.Time) uint16  { return uint16(t.Unix() / 86400) }
func date(d uint16) string    { return time.Unix(int64(d)*86400, 0).UTC().Format("2006-01-02") }
func fail(f string, a ...any) { fmt.Fprintf(os.Stderr, "asn-history: "+f+"\n", a...); os.Exit(1) }
func check(err error, what string) {
	if err != nil {
		fail("%s: %v", what, err)
	}
}

var client = &http.Client{Timeout: 10 * time.Minute}

// open a source: a local file (for tests) or the URL, gunzipped when it is .gz
func open(src string) (io.ReadCloser, error) {
	var rc io.ReadCloser
	if strings.HasPrefix(src, "https://") {
		req, _ := http.NewRequest("GET", src, nil)
		req.Header.Set("User-Agent", "asn-history (+https://github.com/yt1988/asn-lookup)")
		var res *http.Response
		var err error
		for i := 0; i < 3; i++ {
			if res, err = client.Do(req); err == nil && res.StatusCode == 200 {
				break
			}
			if err == nil {
				res.Body.Close()
				err = fmt.Errorf("HTTP %d", res.StatusCode)
			}
			time.Sleep(time.Duration(30*(i+1)) * time.Second)
		}
		if err != nil {
			return nil, fmt.Errorf("%s: %w", src, err)
		}
		rc = res.Body
	} else {
		f, err := os.Open(src)
		if err != nil {
			return nil, err
		}
		rc = f
	}
	if !strings.HasSuffix(src, ".gz") {
		return rc, nil
	}
	z, err := gzip.NewReader(rc)
	if err != nil {
		rc.Close()
		return nil, err
	}
	return struct {
		io.Reader
		io.Closer
	}{z, rc}, nil
}

// today's routes from a riswhoisdump: "<origin> <tab> <prefix> <tab> <seen by #rispeers>", "%" comments; origins
// that are AS sets ({1,2}) are left out, as in scripts/data.mjs
func readRIS(src string, out []Ann) ([]Ann, string, error) {
	rc, err := open(src)
	if err != nil {
		return out, "", err
	}
	defer rc.Close()
	gen := ""
	sc := bufio.NewScanner(rc)
	for sc.Scan() {
		l := sc.Text()
		if strings.HasPrefix(l, "%") {
			if i := strings.Index(l, "generated at "); i >= 0 && gen == "" {
				if t, err := time.Parse("Mon Jan 02 15:04:05 MST 2006", strings.TrimSuffix(strings.TrimSpace(l[i+13:]), ".")); err == nil {
					gen = t.UTC().Format(time.RFC3339)
				}
			}
			continue
		}
		f := strings.Split(l, "\t")
		if len(f) < 3 {
			continue
		}
		n, err := strconv.Atoi(strings.TrimSpace(f[2]))
		if err != nil || n < seen {
			continue
		}
		as, err := strconv.ParseUint(f[0], 10, 32)
		if err != nil {
			continue
		}
		p, ok := parsePfx(f[1])
		if !ok || p.Len == 0 {
			continue
		}
		a := Ann{Hi: p.Hi, AS: uint32(as), Len: p.Len}
		if p.V6 {
			a.Flags = 1
		}
		out = append(out, a)
	}
	return out, gen, sc.Err()
}

// the VRPs of rpki-client's JSON export ({"metadata": {"buildtime"}, "roas": [{"asn", "prefix", "maxLength"}]}), read
// one ROA at a time
func readVRP(src string) ([]VRP, string, error) {
	rc, err := open(src)
	if err != nil {
		return nil, "", err
	}
	defer rc.Close()
	dec := json.NewDecoder(bufio.NewReaderSize(rc, 1<<16))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil, "", errors.New("VRP export: not an object")
	}
	out := make([]VRP, 0, 1200000)
	built := ""
	for dec.More() {
		k, err := dec.Token()
		if err != nil {
			return nil, "", err
		}
		switch k {
		case "metadata":
			var m struct {
				Buildtime string `json:"buildtime"`
			}
			if err := dec.Decode(&m); err != nil {
				return nil, "", err
			}
			built = m.Buildtime
		case "roas":
			if _, err := dec.Token(); err != nil {
				return nil, "", err
			}
			for dec.More() {
				var r struct {
					ASN       any    `json:"asn"`
					Prefix    string `json:"prefix"`
					MaxLength int    `json:"maxLength"`
				}
				if err := dec.Decode(&r); err != nil {
					return nil, "", err
				}
				var as uint64
				switch v := r.ASN.(type) {
				case float64:
					as = uint64(v)
				case string:
					as, _ = strconv.ParseUint(strings.TrimPrefix(strings.ToUpper(v), "AS"), 10, 32)
				}
				p, ok := parsePfx(r.Prefix) // longer than /64: covers no route kept here
				if !ok {
					continue
				}
				out = append(out, VRP{p.Hi, uint32(as), p.Len, uint8(min(r.MaxLength, 128)), p.V6})
			}
			if _, err := dec.Token(); err != nil {
				return nil, "", err
			}
		default:
			var skip json.RawMessage
			if err := dec.Decode(&skip); err != nil {
				return nil, "", err
			}
		}
	}
	return out, built, nil
}

// RFC 6811: a route is valid when a VRP covering its prefix has its origin and a max length at least its length,
// invalid when VRPs cover it but none matches, not found when none covers it
type validator struct {
	v    []VRP
	lens [2][]uint8
}

func newValidator(v []VRP) *validator {
	sort.Slice(v, func(i, j int) bool { return v[i].P().less(v[j].P()) })
	var seen [2][129]bool
	x := &validator{v: v}
	for _, r := range v {
		f := 0
		if r.V6 {
			f = 1
		}
		if !seen[f][r.Len] {
			seen[f][r.Len] = true
			x.lens[f] = append(x.lens[f], r.Len)
		}
	}
	for f := range x.lens {
		sort.Slice(x.lens[f], func(i, j int) bool { return x.lens[f][i] < x.lens[f][j] })
	}
	return x
}

func (x *validator) state(p Pfx, as uint32) uint8 {
	f, covered := 0, false
	if p.V6 {
		f = 1
	}
	for _, l := range x.lens[f] {
		if l > p.Len {
			break
		}
		k := Pfx{p.Hi & mask(l), l, p.V6}
		for i := sort.Search(len(x.v), func(i int) bool { return !x.v[i].P().less(k) }); i < len(x.v) && x.v[i].P() == k; i++ {
			covered = true
			if x.v[i].AS == as && as != 0 && p.Len <= x.v[i].Max {
				return valid
			}
		}
	}
	if covered {
		return invalid
	}
	return notFound
}

// The state file, gzipped, little-endian: "ASNH", version (u32), since, last run (u16 each), the number of routes
// (u64) and each route (Hi u64, AS u32, First, Last, RSince u16, Len, Flags u8: 20 bytes), then the number of ASes
// with count points (u32) and for each its number (u32), how many points (u16) and each point (day u16, N4, N6 u32).
var magic = [4]byte{'A', 'S', 'N', 'H'}

func load(path string) (*State, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return &State{Version: version, Counts: map[uint32][]Point{}}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	z, err := gzip.NewReader(bufio.NewReaderSize(f, 1<<16))
	if err != nil {
		return nil, err
	}
	r := bufio.NewReaderSize(z, 1<<16)
	var b [20]byte
	read := func(n int) []byte {
		if err == nil {
			_, err = io.ReadFull(r, b[:n])
		}
		return b[:n]
	}
	le := binary.LittleEndian
	if h := read(4); err == nil && [4]byte(h) != magic {
		return nil, errors.New("not a state file")
	}
	s := &State{Version: int(le.Uint32(read(4)))}
	if err == nil && s.Version != version {
		return nil, fmt.Errorf("state version %d, want %d", s.Version, version)
	}
	s.Since, s.LastRun = le.Uint16(read(2)), le.Uint16(read(2))
	n := le.Uint64(read(8))
	if err == nil && n > 50_000_000 {
		return nil, errors.New("state: too many routes")
	}
	s.Routes = make([]Route, 0, n)
	for i := uint64(0); i < n && err == nil; i++ {
		x := read(20)
		s.Routes = append(s.Routes, Route{Hi: le.Uint64(x), AS: le.Uint32(x[8:]), First: le.Uint16(x[12:]), Last: le.Uint16(x[14:]),
			RSince: le.Uint16(x[16:]), Len: x[18], Flags: x[19]})
	}
	na := le.Uint32(read(4))
	s.Counts = make(map[uint32][]Point, na)
	for i := uint32(0); i < na && err == nil; i++ {
		as, np := le.Uint32(read(4)), le.Uint16(read(2))
		ps := make([]Point, 0, np)
		for j := uint16(0); j < np && err == nil; j++ {
			x := read(10)
			ps = append(ps, Point{le.Uint16(x), le.Uint32(x[2:]), le.Uint32(x[6:])})
		}
		s.Counts[as] = ps
	}
	if err != nil {
		return nil, fmt.Errorf("state: %w", err)
	}
	return s, nil
}

// write a file whole: to a temporary name beside it, then renamed over it; sync: on the disk before the rename (the
// state; not the 87,000 AS files, which the next run writes again)
func atomic(path string, sync bool, write func(w io.Writer) error) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	bw := bufio.NewWriterSize(f, 1<<16)
	if err = write(bw); err == nil {
		err = bw.Flush()
	}
	if err == nil && sync {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

func save(path string, s *State) error {
	return atomic(path, true, func(w io.Writer) error {
		z := gzip.NewWriter(w)
		le := binary.LittleEndian
		var b []byte
		b = append(b, magic[:]...)
		b = le.AppendUint32(b, version)
		b = le.AppendUint16(b, s.Since)
		b = le.AppendUint16(b, s.LastRun)
		b = le.AppendUint64(b, uint64(len(s.Routes)))
		for _, r := range s.Routes {
			b = le.AppendUint64(b, r.Hi)
			b = le.AppendUint32(b, r.AS)
			b = le.AppendUint16(b, r.First)
			b = le.AppendUint16(b, r.Last)
			b = le.AppendUint16(b, r.RSince)
			b = append(b, r.Len, r.Flags) // 20 bytes a route
			if len(b) > 1<<15 {
				if _, err := z.Write(b); err != nil {
					return err
				}
				b = b[:0]
			}
		}
		b = le.AppendUint32(b, uint32(len(s.Counts)))
		for as, ps := range s.Counts {
			b = le.AppendUint32(b, as)
			b = le.AppendUint16(b, uint16(len(ps)))
			for _, p := range ps {
				b = le.AppendUint16(b, p.Day)
				b = le.AppendUint32(b, p.N4)
				b = le.AppendUint32(b, p.N6)
			}
			if len(b) > 1<<15 {
				if _, err := z.Write(b); err != nil {
					return err
				}
				b = b[:0]
			}
		}
		if _, err := z.Write(b); err != nil {
			return err
		}
		return z.Close()
	})
}

// merge today's routes (sorted, one per prefix and origin, RPKI checked) into the history: a route seen on the last
// run goes on, one not seen then starts a new interval, one gone is left with its last day; routes gone for longer
// than keep go
func merge(s *State, today []Ann, day uint16) []Route {
	out := make([]Route, 0, max(len(s.Routes), len(today))+len(today)/50+1024)
	old, i := s.Routes, 0
	for _, t := range today {
		for i < len(old) && cmp(old[i], t) < 0 {
			if day-old[i].Last <= keep {
				out = append(out, old[i])
			}
			i++
		}
		last := -1
		for i < len(old) && cmp(old[i], t) == 0 {
			if day-old[i].Last <= keep {
				out = append(out, old[i])
				last = len(out) - 1
			}
			i++
		}
		st := t.Flags >> 1
		if last >= 0 && (out[last].Last == s.LastRun || out[last].Last == day) {
			r := &out[last]
			r.Last = day
			if r.RPKI() != st {
				r.setRPKI(st)
				r.RSince = day
			}
			continue
		}
		out = append(out, Route{Hi: t.Hi, AS: t.AS, First: day, Last: day, RSince: day, Len: t.Len, Flags: t.Flags})
	}
	for ; i < len(old); i++ {
		if day-old[i].Last <= keep {
			out = append(out, old[i])
		}
	}
	return out
}

// each AS's prefix counts today, appended to its points when they changed
func count(s *State, day uint16) {
	now := map[uint32][2]uint32{}
	for _, r := range s.Routes {
		if r.Last == day {
			c := now[r.AS]
			c[r.Flags&1]++
			now[r.AS] = c
		}
	}
	for as := range s.Counts {
		if _, ok := now[as]; !ok {
			now[as] = [2]uint32{}
		}
	}
	cut := day - series
	for as, c := range now {
		ps := s.Counts[as]
		if n := len(ps); n > 0 && ps[n-1].Day == day {
			ps = ps[:n-1] // run twice on one day: today's point again
		}
		if n := len(ps); n == 0 || ps[n-1].N4 != c[0] || ps[n-1].N6 != c[1] {
			if n == 0 && c == [2]uint32{} {
				continue
			}
			ps = append(ps, Point{day, c[0], c[1]})
		}
		// the points in the window, and the last one before it (what the count was when the window opens)
		j := sort.Search(len(ps), func(i int) bool { return ps[i].Day >= cut })
		if j > 0 {
			ps = ps[j-1:]
		}
		if len(ps) == 1 && ps[0].N4 == 0 && ps[0].N6 == 0 && day-ps[0].Day > keep {
			delete(s.Counts, as)
			continue
		}
		s.Counts[as] = ps
	}
}

// What an AS file holds (history/README.md)
type ASFile struct {
	AS    uint32           `json:"as"`
	Since string           `json:"since"`
	Day   string           `json:"day"`
	N     [][3]any         `json:"n"`
	Ev    [][3]any         `json:"ev"`
	RPKI  [3]int           `json:"rpki"`
	Px    map[string][]any `json:"px"`
}

type event struct {
	day uint16
	up  bool
	p   Pfx
}

// one AS file at a time, so only one is ever held
func write(s *State, out string, day uint16) (int, error) {
	dir := filepath.Join(out, "as")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return 0, err
	}
	rs := s.Routes
	idx := make([]int32, len(rs)) // the routes in AS order, each AS's in prefix order
	for i := range idx {
		idx[i] = int32(i)
	}
	sort.Slice(idx, func(a, b int) bool {
		if x, y := rs[idx[a]].AS, rs[idx[b]].AS; x != y {
			return x < y
		}
		return idx[a] < idx[b]
	})
	ases := make([]uint32, 0, len(s.Counts)+1000)
	for as := range s.Counts {
		ases = append(ases, as)
	}
	for k, i := range idx {
		if k == 0 || rs[i].AS != rs[idx[k-1]].AS {
			ases = append(ases, rs[i].AS)
		}
	}
	sort.Slice(ases, func(a, b int) bool { return ases[a] < ases[b] })
	u := ases[:0]
	for k, as := range ases {
		if k == 0 || as != ases[k-1] {
			u = append(u, as)
		}
	}
	ases = u

	since, today, k := date(s.Since), date(day), 0
	var evs []event
	for _, as := range ases {
		f := ASFile{AS: as, Since: since, Day: today, N: [][3]any{}, Ev: [][3]any{}, Px: map[string][]any{}}
		evs = evs[:0]
		for ; k < len(idx) && rs[idx[k]].AS == as; k++ {
			i := int(idx[k])
			r, p := rs[i], rs[i].P()
			if r.First > s.Since {
				evs = append(evs, event{r.First, true, p})
			}
			if r.Last != day {
				evs = append(evs, event{r.Last + 1, false, p})
				continue
			}
			f.RPKI[r.RPKI()]++
			// [first day of this interval, RPKI, since when, other origins now, earlier other origins [as, first, last]]
			e := []any{date(r.First), rpkiCode[r.RPKI()], date(r.RSince)}
			lo, hi := i, i+1
			for lo > 0 && rs[lo-1].P() == p {
				lo--
			}
			for hi < len(rs) && rs[hi].P() == p {
				hi++
			}
			now, was := []uint32{}, [][3]any{}
			for _, o := range rs[lo:hi] {
				if o.AS == as {
					continue
				}
				if o.Last == day {
					now = append(now, o.AS)
				} else {
					was = append(was, [3]any{o.AS, date(o.First), date(o.Last)})
				}
			}
			if len(now) > 0 || len(was) > 0 {
				e = append(e, now)
			}
			if len(was) > 0 {
				e = append(e, was)
			}
			f.Px[p.String()] = e
		}
		for _, pt := range s.Counts[as] {
			f.N = append(f.N, [3]any{date(pt.Day), pt.N4, pt.N6})
		}
		sort.Slice(evs, func(i, j int) bool {
			if evs[i].day != evs[j].day {
				return evs[i].day > evs[j].day
			}
			return evs[i].p.less(evs[j].p)
		})
		for n, e := range evs {
			if n == events {
				break
			}
			up := 0
			if e.up {
				up = 1
			}
			f.Ev = append(f.Ev, [3]any{date(e.day), up, e.p.String()})
		}
		b, err := json.Marshal(f)
		if err != nil {
			return 0, err
		}
		if err := atomic(filepath.Join(dir, fmt.Sprintf("%d.json", as)), false, func(w io.Writer) error { _, err := w.Write(b); return err }); err != nil {
			return 0, err
		}
	}
	// an AS whose history ran out has no file any more
	ents, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	for _, e := range ents {
		name := e.Name()
		if strings.HasSuffix(name, ".tmp") {
			os.Remove(filepath.Join(dir, name))
			continue
		}
		n, err := strconv.ParseUint(strings.TrimSuffix(name, ".json"), 10, 32)
		if err != nil || !strings.HasSuffix(name, ".json") {
			continue
		}
		if j := sort.Search(len(ases), func(i int) bool { return ases[i] >= uint32(n) }); j == len(ases) || ases[j] != uint32(n) {
			os.Remove(filepath.Join(dir, name))
		}
	}
	return len(ases), nil
}

// the most memory the process held (Linux), in MB
func peakMB() int {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		return int(m.Sys >> 20)
	}
	for _, l := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(l, "VmHWM:") {
			kb, _ := strconv.Atoi(strings.Fields(l)[1])
			return kb >> 10
		}
	}
	return 0
}

func main() {
	stateDir := flag.String("state", "/var/lib/1ms-asn-history", "where the history is kept")
	out := flag.String("out", "/srv/1ms-data/asn", "where the files for the Worker go")
	ris4 := flag.String("ris4", sources["ris4"], "RIS IPv4 dump (URL or file)")
	ris6 := flag.String("ris6", sources["ris6"], "RIS IPv6 dump (URL or file)")
	vrp := flag.String("vrp", sources["vrp"], "rpki-client VRP JSON (URL or file)")
	at := flag.String("day", "", "run as this day (YYYY-MM-DD), for tests")
	flag.Parse()
	start := time.Now()
	today := day(start)
	if *at != "" {
		t, err := time.Parse("2006-01-02", *at)
		check(err, "-day")
		today = day(t)
	}

	// today: the routes, each checked against the VRPs, which then go
	anns := make([]Ann, 0, 1700000)
	anns, gen4, err := readRIS(*ris4, anns)
	check(err, "RIS IPv4")
	n4 := len(anns)
	anns, _, err = readRIS(*ris6, anns)
	check(err, "RIS IPv6")
	vrps, built, err := readVRP(*vrp)
	check(err, "VRPs")
	nVRP := len(vrps)
	// a cut-short download would read as half the Internet going away: stop before keeping anything
	if n4 < 500000 || len(anns)-n4 < 50000 || nVRP < 200000 {
		fail("too little data: %d IPv4 routes, %d IPv6 routes, %d VRPs", n4, len(anns)-n4, nVRP)
	}
	sort.Slice(anns, func(i, j int) bool { return annLess(anns[i], anns[j]) })
	uniq := anns[:0]
	for i, a := range anns {
		if i == 0 || annLess(anns[i-1], a) {
			uniq = append(uniq, a)
		}
	}
	anns = uniq
	val := newValidator(vrps)
	for i := range anns {
		anns[i].Flags = anns[i].Flags&1 | val.state(anns[i].P(), anns[i].AS)<<1
	}
	val, vrps = nil, nil
	runtime.GC()

	// then the history
	path := filepath.Join(*stateDir, "state.bin.gz")
	s, err := load(path)
	check(err, "state")
	if s.LastRun > today {
		fail("the last run (%s) is after today (%s)", date(s.LastRun), date(today))
	}
	if s.Since == 0 {
		s.Since = today
	}
	s.Routes = merge(s, anns, today)
	anns = nil
	runtime.GC()
	count(s, today)
	prev := s.LastRun
	s.LastRun = today
	check(os.MkdirAll(*stateDir, 0o755), "state")
	check(save(path, s), "state")

	check(os.MkdirAll(*out, 0o755), "out")
	ases, err := write(s, *out, today)
	check(err, "AS files")
	active, added, gone := 0, 0, 0
	for _, r := range s.Routes {
		switch {
		case r.Last == today:
			active++
			if r.First == today && today != s.Since {
				added++
			}
		case r.Last == prev:
			gone++
		}
	}
	m := Meta{Since: date(s.Since), Day: date(today), At: time.Now().UTC().Format(time.RFC3339), RIS: gen4, VRPAt: built,
		Routes: active, Added: added, Gone: gone, Kept: len(s.Routes), VRPs: nVRP, ASes: ases, Took: time.Since(start).Round(time.Second).String(), PeakMB: peakMB()}
	b, _ := json.MarshalIndent(m, "", "  ")
	check(atomic(filepath.Join(*out, "meta.json"), false, func(w io.Writer) error { _, err := w.Write(b); return err }), "meta")
}
