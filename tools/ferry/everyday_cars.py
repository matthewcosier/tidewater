"""Everyday traffic: five original cars of the kinds that queue for the Kangaroo Island ferry
(docs/cars.md, Everyday traffic). Built from code, no imported meshes, no badges and no grille trade
dress. Each is sized after its class leader on South Australian roads (2024 model-year spec sheets):

  ParkedHatch  small hatch     after a Corolla hatch (E210): 4.37 x 1.79 x 1.44 m, wheelbase 2.64 m, 205/55 R16
  ParkedSedan  mid sedan       after a Camry (XV70):         4.885 x 1.84 x 1.445 m, wheelbase 2.825 m, 215/55 R17
  ParkedSuv    compact SUV     after a RAV4 (XA50):          4.60 x 1.855 x 1.685 m, wheelbase 2.69 m, 225/65 R17
  ParkedUte    dual-cab ute    after a HiLux SR5 double cab: 5.325 x 1.855 x 1.815 m, wheelbase 3.085 m, 265/60 R18
  ParkedVan    van             after a HiAce LWB (H300):     5.265 x 1.95 x 1.99 m, wheelbase 3.21 m, 215/70 R16C

Each body is one loft along the car: a cross-section of 15 points a side (underbody, wheel well,
rocker, door, shoulder, glass, roof) at about 75 stations, its keylines (roof, bonnet, belt, sill,
plan width) monotone cubics through the reference points below. Faces take their material from where
they sit (glass in the greenhouse, black in the wells), so glass, pillars and panels share edges and
never z-fight. Lamps are patches lifted off the same surface; panel lines, seals and mouldings are
thin tubes on it; seats, dash and wheel show through the glass as dark shapes.

Contract (the one tools/ferry/parked_cars.py documents; parked_cars.py calls build_all()): Blender Z up,
nose -Y (glTF Y up, nose +Z), one root mesh per car on the ground, centred in plan, and four child
nodes <root>WheelFrontL, ..R, <root>WheelRearL, ..R (L on -X) with identity rotation at the hubs,
each wheel's mesh centred on its hub (spins about local X, steers about local Y).

Materials, shared by all five so the car park batches them: Paint (white 0.8; the game tints it per
car: src/ferry/carPaint.js), Glass (the import palette's tinted glass, blended), Trim (black plastic,
rubber, wells, interior), Lamp (clear lens and plates), TailLamp, Rim. Draws a car: 5 body + 2 wheel = 7,
the traffic-wheels.spec bound. Budget: about 6 to 7.5k body triangles, wheels about 1.1k each
(parked_cars WHEEL_TRIS is 1600).

To render the five cars, set TW_PREVIEW to an output directory:
  TW_PREVIEW=/path Blender --background --factory-startup --python tools/ferry/everyday_cars.py
The game file is written by tools/ferry/parked_cars.py, which builds these through build_all().
"""
import math, os, sys
from pathlib import Path
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'rally'))
from blender_primitives import cube, line, ring, cylinder, join_group

WHEELS = ('WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR')

# s is metres back from the nose; keylines are [(s, z)] in metres above the ground.
CARS = [
    dict(name='ParkedHatch', L=4.37, W=1.79, wb=2.64, track=1.54, r=0.316, tw=0.205, rim=0.203, fo=0.90, spokes=5,
         top=[(0, .60), (.05, .76), (.16, .82), (.98, .94), (1.78, 1.415), (2.35, 1.44), (3.62, 1.39), (4.16, 1.00), (4.24, .99), (4.34, .76), (4.37, .68)],
         bot=[(0, .28), (.35, .17), (.75, .15), (3.85, .16), (4.37, .36)],
         belt=[(0, .80), (.98, .93), (3.55, 1.01), (4.37, .98)],
         plan=(.16, .62, .09, .40), tumble=.17, cowl=.98, rf=1.78, rr=3.62, rg=4.12,
         side=(1.10, 3.52), pillars=[(2.57, 2.66), (3.36, 3.52)], grille=(.004, .045), intake=.46,
         hl=(.012, .30, 10.7, 12.35), tl=(4.10, 4.36, 7.4, 11.4), doors=[1.05, 2.62, 3.42], seats=2, cladding=False),
    dict(name='ParkedSedan', L=4.885, W=1.84, wb=2.825, track=1.58, r=0.334, tw=0.215, rim=0.216, fo=0.98, spokes=10,
         top=[(0, .60), (.05, .75), (.18, .82), (1.12, .93), (1.98, 1.42), (2.60, 1.445), (3.32, 1.42), (4.08, 1.04), (4.68, 1.00), (4.82, .94), (4.885, .66)],
         bot=[(0, .28), (.38, .16), (.80, .14), (4.25, .15), (4.885, .38)],
         belt=[(0, .79), (1.12, .91), (4.05, 1.00), (4.885, .96)],
         plan=(.16, .66, .10, .45), tumble=.18, cowl=1.12, rf=1.98, rr=3.32, rg=4.06,
         side=(1.24, 3.70), pillars=[(2.80, 2.89), (3.48, 3.70)], grille=(.004, .045), intake=.50,
         hl=(.012, .30, 10.7, 12.35), tl=(4.66, 4.88, 7.4, 11.6), doors=[1.20, 2.85, 3.62], seats=2, cladding=False),
    dict(name='ParkedSuv', L=4.60, W=1.855, wb=2.69, track=1.61, r=0.362, tw=0.225, rim=0.216, fo=0.94, spokes=6,
         top=[(0, .68), (.06, .90), (.18, .97), (1.06, 1.08), (1.86, 1.64), (2.50, 1.685), (3.95, 1.665), (4.42, 1.58), (4.53, 1.12), (4.60, .78)],
         bot=[(0, .40), (.32, .22), (.70, .20), (4.10, .21), (4.60, .44)],
         belt=[(0, .96), (1.06, 1.08), (4.35, 1.16), (4.60, 1.10)],
         plan=(.14, .60, .07, .38), tumble=.15, cowl=1.06, rf=1.86, rr=4.30, rg=4.50,
         side=(1.20, 4.18), pillars=[(2.62, 2.71), (3.52, 3.62)], grille=(.004, .055), intake=.52,
         hl=(.012, .30, 10.7, 12.35), tl=(4.30, 4.58, 7.0, 11.0), doors=[1.16, 2.66, 3.58], seats=2, cladding=True, rails=True),
    dict(name='ParkedUte', L=5.325, W=1.80, wb=3.085, track=1.54, r=0.388, tw=0.265, rim=0.229, fo=0.90, spokes=6,
         top=[(0, .82), (.07, 1.06), (.22, 1.12), (1.16, 1.21), (1.88, 1.78), (2.30, 1.815), (3.22, 1.80), (3.27, 1.74), (3.31, 1.17), (5.22, 1.15), (5.29, 1.10), (5.325, .84)],
         bot=[(0, .46), (.36, .27), (.70, .25), (4.60, .30), (5.325, .52)],
         belt=[(0, 1.06), (1.16, 1.21), (3.24, 1.25), (3.31, 1.16), (5.325, 1.14)],
         plan=(.13, .62, .03, .25), tumble=.15, cowl=1.16, rf=1.88,
         side=(1.30, 3.14), pillars=[(2.30, 2.39)], grille=(.004, .065), intake=.56, cab=3.31, rr=None, rg=None,
         hl=(.012, .30, 10.7, 12.35), tl=(5.12, 5.32, 5.6, 7.9), doors=[1.24, 2.34, 3.22], seats=2, cladding=True),
    dict(name='ParkedVan', L=5.265, W=1.95, wb=3.21, track=1.66, r=0.354, tw=0.215, rim=0.203, fo=0.82, spokes=8,
         top=[(0, .72), (.07, .96), (.22, 1.06), (.80, 1.13), (1.46, 1.93), (1.95, 1.99), (5.16, 1.985), (5.24, 1.94), (5.265, 1.90)],
         bot=[(0, .40), (.30, .25), (.62, .22), (4.80, .24), (5.265, .38)],
         belt=[(0, 1.00), (.80, 1.13), (5.265, 1.20)],
         plan=(.12, .52, .02, .20), tumble=.10, cowl=.80, rf=1.46, rr=None, rg=None,
         side=(.92, 2.00), pillars=[], grille=(.004, .065), intake=.58,
         hl=(.05, .29, 10.7, 12.35), tl=(5.02, 5.26, 5.4, 8.6), doors=[.92, 2.02, 2.10, 3.35], seats=1, cladding=False, van=True),
]

BUL = 0.012          # m, the door's outward bulge past the rocker line


def get_mat(name, rgba, metallic, rough, alpha=None):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgba[:3], 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = rough
    if alpha is not None:
        bsdf.inputs['Alpha'].default_value = alpha
        mat.surface_render_method = 'BLENDED'
    return mat


def materials():
    return dict(
        Paint=get_mat('Paint', (.80, .80, .80, 1), .35, .30),
        # the import palette's Glass (tools/rally/import_cars.py PALETTE), so traffic glass reads as the hero cars' does
        Glass=get_mat('Glass', (.038, .078, .094, .78), .28, .12, alpha=.78),
        Trim=get_mat('Trim', (.016, .018, .02, 1), .04, .72),
        Lamp=get_mat('Lamp', (.50, .53, .55, 1), .90, .08),
        TailLamp=get_mat('TailLamp', (.55, .008, .008, 1), .28, .19),
        Rim=get_mat('Rim', (.56, .58, .60, 1), .85, .30),
    )


def pchip(keys):
    """Monotone cubic through [(s, z)]: smooth keylines that never overshoot their reference points."""
    xs = [k[0] for k in keys]; ys = [k[1] for k in keys]
    n = len(xs)
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0] * (n - 2) + [d[-1]]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] > 0:
            w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]); w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1])
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    def f(s):
        s = min(max(s, xs[0]), xs[-1])
        i = max(0, min(n - 2, next((k for k in range(n - 1) if s <= xs[k + 1]), n - 2)))
        h = xs[i + 1] - xs[i]; t = (s - xs[i]) / h
        return ((2 * t ** 3 - 3 * t ** 2 + 1) * ys[i] + (t ** 3 - 2 * t ** 2 + t) * h * m[i]
                + (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1] + (t ** 3 - t ** 2) * h * m[i + 1])
    return f


class Car:
    def __init__(self, c):
        self.c = c
        self.top, self.bot, self.belt = pchip(c['top']), pchip(c['bot']), pchip(c['belt'])
        self.axles = (c['fo'], c['fo'] + c['wb'])
        self.R = c['r'] + 0.055          # m: the arch's radius, a tyre plus a hand's clearance

    def hw(self, s):
        kf, rf, kr, rr = self.c['plan']; L = self.c['L']
        ef = max(0.0, 1 - s / rf); er = max(0.0, 1 - (L - s) / rr)
        return (self.c['W'] / 2 - BUL) * (1 - kf * ef ** 2 - kr * er ** 2)

    def arch(self, s, bot):
        z = bot
        for a in self.axles:
            d = abs(s - a)
            if d < self.R:
                z = max(z, self.c['r'] + 0.02 + math.sqrt(self.R ** 2 - d ** 2))
        return z

    def loop(self, s):
        """The right half's cross-section at s: 15 (x, z) points from the underbody's middle round to the roof's."""
        top, bot = self.top(s), self.bot(s)
        belt = min(self.belt(s), top - 0.03)
        hw = self.hw(s)
        az = min(self.arch(s, bot), belt - 0.10)
        g = min(1.0, max(0.0, (top - belt - 0.05) / 0.30))        # how much greenhouse stands above the belt here
        rw = hw - 0.012 - g * self.c['tumble']
        base = max(az, bot)
        p8 = (hw - 0.012, belt)
        pe = (rw, max(belt + 0.005, top - 0.025 - 0.035 * g))
        lerp = lambda a, b, t, bow: (a[0] + (b[0] - a[0]) * t + bow, a[1] + (b[1] - a[1]) * t)
        return [(0.0, bot), (hw - 0.30, bot), (hw - 0.30, az), (hw - 0.035, az), (hw - 0.004, az + 0.025),
                (hw + BUL * 0.6, base + 0.30 * (belt - base)), (hw + BUL, base + 0.62 * (belt - base)),
                (hw + BUL * 0.5, belt - 0.035), p8,
                lerp(p8, pe, 0.36, 0.006 * g), lerp(p8, pe, 0.72, 0.004 * g), pe,
                (rw * 0.88, top - 0.008 - 0.006 * g), (rw * 0.45, top - 0.002), (0.0, top)]

    def P(self, s, u, side=1):
        pts = self.loop(s)
        k = max(0, min(13, int(math.floor(u)))); f = u - k
        x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f
        z = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f
        return Vector((side * x, -self.c['L'] / 2 + s, z))

    def N(self, s, u, side=1):
        ds, du = 0.004, 0.02
        n = (self.P(s + ds, u, side) - self.P(s - ds, u, side)).cross(self.P(s, u + du, side) - self.P(s, u - du, side))
        if side < 0: n = -n
        return n.normalized() if n.length > 1e-9 else Vector((side, 0, 0))

    def stations(self):
        L = self.c['L']; step = max(0.09, 0.09 * L / 4.6)                          # m: the long ute and van a little coarser, inside 9.5k
        st = set(round(i * step, 4) for i in range(int(L / step) + 1)) | {0.0, L}
        for a in self.axles:
            for f in (-1.0, -0.97, -0.88, -0.7, -0.45, -0.2, 0.0, 0.2, 0.45, 0.7, 0.88, 0.97, 1.0):
                st.add(round(a + f * (self.R - 0.003), 4))
            st.add(round(a - self.R - 0.003, 4)); st.add(round(a + self.R + 0.003, 4))
        for key in ('cowl', 'rf', 'rr', 'rg', 'cab'):
            if self.c.get(key):
                st.add(round(self.c[key], 4))
        for a, b in self.c['pillars']:
            st |= {a, b}
        st |= set(self.c['side'])
        for s, _ in self.c['top']:
            st.add(s)
        return sorted(v for v in st if 0 <= v <= L)

    def band_mat(self, s, band):
        c = self.c
        if band <= 3:
            return 'Trim'                                     # underbody and wheel wells
        if band == 4 and c.get('cladding'):
            return 'Trim'                                     # black sill cladding on the SUV and ute
        if c.get('cab') and s > c['cab'] + 0.01 and band >= 8:
            return 'Trim'                                     # the ute's tub under a tonneau cover
        if 8 <= band <= 10:
            s0, s1 = c['side']
            if s0 <= s <= s1 and not any(a <= s <= b for a, b in c['pillars']):
                return 'Glass'
            return 'Paint'
        if band >= 12:
            if c['cowl'] + 0.03 <= s <= c['rf'] - 0.02:
                return 'Glass'                                # windscreen
            if c.get('rr') and c['rr'] + 0.03 <= s <= c['rg'] - 0.02:
                return 'Glass'                                # rear window
            g0, g1 = c['grille']
            if g0 <= s <= g1 and band == 13:
                return 'Trim'                                 # the upper grille slot, plain mesh
        return 'Paint'


class Buf:
    def __init__(self):
        self.v, self.f, self.m = [], [], []

    def add(self, verts, faces, mat):
        o = len(self.v); self.v += [tuple(p) for p in verts]
        self.f += [tuple(i + o for i in face) for face in faces]
        self.m += mat if isinstance(mat, list) else [mat] * len(faces)

    def obj(self, name, mats):
        names = list(dict.fromkeys(self.m))
        data = bpy.data.meshes.new(name)
        data.from_pydata(self.v, [], self.f)
        for n in names: data.materials.append(mats[n])
        for p, n in zip(data.polygons, self.m):
            p.material_index = names.index(n); p.use_smooth = True
        data.update()
        o = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(o)
        return o


NOSE_R = 0.04      # m: the front bumper's rounding into its face, a moulded fascia's radius


def patch(buf, car, s0, s1, u0, u1, mat, off, ns=6, nu=4, u0e=None, u1e=None):
    """A panel lifted `off` metres off the body over stations s0..s1 and section points u0..u1, both sides.
    u0e/u1e, when given, are the section points at s1 (the panel tapers linearly from s0 to s1)."""
    u0e = u0 if u0e is None else u0e
    u1e = u1 if u1e is None else u1e
    for side in (1, -1):
        verts = []
        for i in range(ns + 1):
            s = s0 + (s1 - s0) * i / ns
            ua, ub = u0 + (u0e - u0) * i / ns, u1 + (u1e - u1) * i / ns
            for j in range(nu + 1):
                u = ua + (ub - ua) * j / nu
                verts.append(car.P(s, u, side) + car.N(s, u, side) * off)
        faces = []
        for i in range(ns):
            for j in range(nu):
                a, b, cc, d = i * (nu + 1) + j, (i + 1) * (nu + 1) + j, (i + 1) * (nu + 1) + j + 1, i * (nu + 1) + j + 1
                faces.append((a, b, cc, d) if side > 0 else (a, d, cc, b))
        buf.add(verts, faces, mat)


def quad(buf, x0, x1, z0, z1, y, facing, mat):
    v = [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]
    buf.add(v, [(0, 1, 2, 3) if facing < 0 else (0, 3, 2, 1)], mat)


def box(buf, centre, size, mat):
    """An unbevelled box, 12 triangles: vanes, lips, pods and plates read at 10 m without a bevel's 200."""
    (cx, cy, cz), (sx, sy, sz) = centre, size
    v = [(cx + i * sx / 2, cy + j * sy / 2, cz + k * sz / 2) for i in (-1, 1) for j in (-1, 1) for k in (-1, 1)]
    buf.add(v, [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)], mat)


def disc(buf, car, sm, um, r, mat, off, n=12):
    """A round lens r metres in radius on the body at (sm, um), lifted `off` metres, both sides."""
    ru = r * 0.1 / max((car.P(sm, um + 0.05) - car.P(sm, um - 0.05)).length, 1e-6)    # r in units of u here
    for side in (1, -1):
        verts = [car.P(sm, um, side) + car.N(sm, um, side) * off]
        for k in range(n):
            a = math.tau * k / n
            s, u = sm + r * math.cos(a), um + ru * math.sin(a)
            verts.append(car.P(s, u, side) + car.N(s, u, side) * off)
        buf.add(verts, [(0, k + 1, (k + 1) % n + 1) if side > 0 else (0, (k + 1) % n + 1, k + 1) for k in range(n)], mat)


def bowl(buf, car, sm, um, r0, off0, r1, off1, mat, n=14):
    """A reflector bowl on the body at (sm, um), both sides: a cone from radius r0 at `off0` metres off the
    surface down to r1 at `off1`, open at the bottom for a lens."""
    ru = 0.1 / max((car.P(sm, um + 0.05) - car.P(sm, um - 0.05)).length, 1e-6)       # metres to u here
    for side in (1, -1):
        verts = []
        for r, off in ((r0, off0), (r1, off1)):
            for k in range(n):
                a = math.tau * k / n
                s, u = sm + r * math.cos(a), um + r * ru * math.sin(a)
                verts.append(car.P(s, u, side) + car.N(s, u, side) * off)
        buf.add(verts, [(k, (k + 1) % n, n + (k + 1) % n, n + k) if side > 0 else (k, n + k, n + (k + 1) % n, (k + 1) % n) for k in range(n)], mat)


def surface_line(car, name, pts, radius, mat, lift=0.0, side=1):
    """A tube along the body through (s, u) points, `lift` metres off the surface (negative sinks it into a seam)."""
    return line(name, [tuple(car.P(s, u, side) + car.N(s, u, side) * lift) for s, u in pts], radius, mat, group=None)


def build_body(c, M, at):
    car = Car(c); L = c['L']; buf = Buf()
    st = car.stations()
    rings = []
    for s in st:
        pts = car.loop(s); y = -L / 2 + s
        rings.append([(x, y, z) for x, z in pts] + [(-x, y, z) for x, z in reversed(pts[1:-1])])
    R = len(rings[0])                                          # 28: 15 a side, the two middles shared
    verts = [p for r in rings for p in r]
    faces, mats = [], []
    for i in range(len(st) - 1):
        sm = (st[i] + st[i + 1]) / 2
        for r in range(R):
            a, b = i * R + r, i * R + (r + 1) % R
            faces.append((a, a + R, b + R, b)); mats.append(car.band_mat(sm, r if r < 14 else 27 - r))
    buf.add(verts, faces, mats)
    b0, t0 = car.bot(0), car.top(0)
    front = rings[0]
    for k, th in enumerate((math.pi / 6, math.pi / 3, math.pi / 2)):
        d, inset = NOSE_R * math.sin(th), NOSE_R * (1 - math.cos(th))
        ring_ = [(math.copysign(max(0.0, abs(x) - inset), x) if abs(x) > 1e-9 else 0.0, y - d,
                  z if z <= b0 + 1e-6 else max(b0, min(z, t0 - inset))) for x, y, z in rings[0]]
        buf.add(ring_ + front, [(r, R + r, R + (r + 1) % R, (r + 1) % R) for r in range(R)],      # wound as the body loft, forward ring first
                [car.band_mat(0.0, r if r < 14 else 27 - r) for r in range(R)])
        front = ring_
    cz = (b0 + t0) / 2
    yc = -L / 2 - NOSE_R
    keep = [0]
    for r in range(1, R):
        if (Vector(front[r]) - Vector(front[keep[-1]])).length > 0.001:
            keep.append(r)
    if (Vector(front[keep[-1]]) - Vector(front[0])).length <= 0.001:
        keep.pop()
    outer, inner = [front[r] for r in keep], []
    for x, y, z in outer:
        d = math.hypot(x, z - cz)
        k = 1 - min(0.03, 0.4 * d) / max(d, 1e-9)                # m: 3 cm in, never past 40 % of the way
        inner.append((x * k, yc, cz + (z - cz) * k))
    K = len(outer)
    buf.add(inner + outer, [(r, K + r, K + (r + 1) % K, (r + 1) % K) for r in range(K)], 'Paint')
    buf.add([(0.0, yc, cz)] + inner, [(0, r + 1, (r + 1) % K + 1) for r in range(K)], 'Paint')
    ring_ = rings[-1]; cz = (car.bot(st[-1]) + car.top(st[-1])) / 2
    buf.add([(0.0, -L / 2 + st[-1], cz)] + ring_, [(0, (r + 1) % R + 1, r + 1) for r in range(R)], 'Paint')
    yf, yr = -L / 2 - NOSE_R - 0.004, L / 2 + 0.004
    pc = (b0 + t0) / 2 + 0.02
    box(buf, (0, yf - 0.001, pc), (0.412, 0.004, 0.174), 'Trim')
    box(buf, (0, yf - 0.006, pc), (0.372, 0.006, 0.134), 'Lamp')
    gi, g_lo, g_hi = c['intake'], b0 + 0.02, pc - 0.067 - 0.025
    quad(buf, -gi, gi, g_lo, g_hi, yf, -1, 'Trim')
    n = int(gi / 0.11)
    for k in range(-n, n + 1):
        box(buf, (k * 0.11, yf - 0.007, (g_lo + g_hi) / 2), (0.022, 0.014, g_hi - g_lo - 0.008), 'Trim')
    box(buf, (0, yf - 0.006, g_hi + 0.008), (2 * gi + 0.04, 0.012, 0.010), 'Lamp')
    for sx in (1, -1):
        box(buf, (sx * (gi + 0.10), yf - 0.003, g_lo + 0.045), (0.15, 0.008, 0.07), 'Trim')
        box(buf, (sx * (gi + 0.10), yf - 0.009, g_lo + 0.045), (0.10, 0.006, 0.034), 'Lamp')
    bl, tl = car.bot(L), car.top(L)
    pz = min(tl - 0.04, bl + 0.24)
    box(buf, (0, yr + 0.001, pz - 0.067), (0.412, 0.004, 0.174), 'Trim')
    box(buf, (0, yr + 0.006, pz - 0.067), (0.372, 0.006, 0.134), 'Lamp')
    quad(buf, -c['intake'] * 0.9, c['intake'] * 0.9, bl + 0.01, bl + 0.06, yr, 1, 'Trim')   # rear diffuser strip
    if c.get('van'):
        # the rear doors' glass and the split between them, and tall tail lamps up the corners
        quad(buf, 0.04, 0.64, 1.30, 1.80, yr, 1, 'Glass')
        quad(buf, -0.64, -0.04, 1.30, 1.80, yr, 1, 'Glass')
        quad(buf, -0.012, 0.012, bl + 0.08, tl - 0.04, yr + 0.002, 1, 'Trim')
    s0, s1, u0, u1 = c['hl']
    du = u1 - u0
    lo = lambda f: u0 + 0.40 * du * f                                       # the housing's lower edge
    patch(buf, car, s0, s1, u0, u1, 'Trim', 0.003, 6, 4, u0e=lo(1))
    patch(buf, car, s0, s1, u0, u1, 'Glass', 0.004, 6, 4, u0e=lo(1))
    patch(buf, car, s0 + 0.012, s1 - 0.012, lo(0) + 0.06 * du, lo(0) + 0.14 * du, 'Lamp', 0.009, 6, 1,
          u0e=lo(1) + 0.06 * du, u1e=lo(1) + 0.14 * du)
    patch(buf, car, s1 - 0.034, s1 - 0.012, lo(1) + 0.06 * du, u1 - 0.12 * du, 'Lamp', 0.009, 1, 3)
    for f, r in ((0.30, 0.018), (0.66, 0.013)):
        sm, um = s0 + (s1 - s0) * f, u0 + 0.64 * du
        bowl(buf, car, sm, um, r + 0.006, 0.0085, r, 0.0065, 'Trim')
        bowl(buf, car, sm, um, r, 0.0065, 0.45 * r, 0.005, 'Lamp')
        disc(buf, car, sm, um, 0.45 * r, 'Lamp', 0.005)
    # tail lamps: the red unit, a black divider across it and a clear reversing lamp at its inner end
    s0, s1, u0, u1 = c['tl']
    du = u1 - u0
    patch(buf, car, s0, s1, u0, u1, 'TailLamp', 0.005, 5, 4)
    patch(buf, car, s0 + 0.008, s1 - 0.008, u0 + 0.47 * du, u0 + 0.53 * du, 'Trim', 0.007, 4, 1)
    patch(buf, car, s0 + 0.35 * (s1 - s0), s1 - 0.01, u0 + 0.62 * du, u0 + 0.86 * du, 'Lamp', 0.007, 2, 1)
    body = buf.obj(c['name'] + 'Shell', M)
    parts = [body]

    # panel lines: tubes sunk half into the paint, door cuts from the sill to the belt
    for k, s in enumerate(c['doors']):
        parts.append(surface_line(car, 'Door cut', [(s, 4.4), (s, 5.5), (s, 6.6), (s, 7.6)], 0.0035, M['Trim']))
    parts.append(surface_line(car, 'Bonnet shut', [(0.14, 11.4), (c['cowl'] * 0.5, 11.3), (c['cowl'] - 0.02, 11.2), (c['cowl'] - 0.02, 12.6), (c['cowl'] - 0.02, 14)], 0.003, M['Trim']))
    parts.append(surface_line(car, 'Bonnet shut', [(0.14, 11.4), (c['cowl'] * 0.5, 11.3), (c['cowl'] - 0.02, 11.2), (c['cowl'] - 0.02, 12.6), (c['cowl'] - 0.02, 14)], 0.003, M['Trim'], side=-1))
    s0, s1 = c['side']
    for side in (1, -1):
        # the belt seal and the drip rail over the side glass
        parts.append(surface_line(car, 'Belt seal', [(s0 + 0.05, 8.05), ((s0 + s1) / 2, 8.05), (s1, 8.05)], 0.006, M['Trim'], 0.002, side))
        parts.append(surface_line(car, 'Drip rail', [(s0 + 0.15, 10.95), ((s0 + s1) / 2, 10.95), (s1, 10.95)], 0.005, M['Trim'], 0.002, side))
        # wheel arch lips (black flares on the SUV and ute)
        for a in car.axles:
            arc = []
            for k in range(11):
                t = -math.pi / 2 + k * math.pi / 10
                s = a + car.R * math.sin(t)
                z = c['r'] + 0.02 + car.R * math.cos(t) + 0.012
                x = car.hw(s) + (0.022 if c.get('cladding') else 0.004)
                arc.append((side * x, -L / 2 + s, max(z, car.bot(s) + 0.02)))
            parts.append(line('Arch lip', arc, 0.028 if c.get('cladding') else 0.010, M['Trim'], group=None))
        # mirror: arm and black housing, its glass facing aft
        ms = c['cowl'] + 0.16; mz = car.belt(ms) + 0.06; mx = car.hw(ms)
        parts.append(cube('Mirror arm', (side * (mx + 0.05), -L / 2 + ms, mz - 0.02), (0.10, 0.06, 0.04), M['Trim'], bevel=0, group=None))
        parts.append(cube('Mirror housing', (side * (mx + 0.14), -L / 2 + ms, mz + 0.02), (0.20, 0.10, 0.13), M['Trim'], bevel=0.025, group=None))
        parts.append(cube('Mirror glass', (side * (mx + 0.14), -L / 2 + ms + 0.051, mz + 0.02), (0.17, 0.004, 0.10), M['Lamp'], bevel=0, group=None))
        # door handles, body colour, just under the shoulder
        for k in range(len(c['doors']) - 1):
            if c.get('van') and k == 1:
                continue
            hs = c['doors'][k + 1] - 0.16
            hx = car.hw(hs) + BUL + 0.004
            parts.append(cube('Door handle', (side * hx, -L / 2 + hs, car.belt(hs) - 0.09), (0.016, 0.15, 0.03), M['Paint'], bevel=0, group=None))
    # the upper grille: bright slats standing 8 mm proud across its black slot, in a bright surround
    # (Lamp, not Rim: a sixth body material would be an eighth draw)
    g0, g1 = c['grille']
    grille = Buf()
    for f in (0.0, 0.25, 0.5, 0.75, 1.0):
        sk = g0 + (g1 - g0) * f
        patch(grille, car, sk - 0.0025, sk + 0.0025, 12.96, 14.0, 'Lamp', 0.008 if 0 < f < 1 else 0.005, 1, 3)
    patch(grille, car, g0, g1, 12.90, 13.02, 'Lamp', 0.005, 3, 1)
    parts.append(grille.obj(c['name'] + 'Grille', M))
    # wipers at the base of the windscreen
    for x0 in (-0.55, 0.0):
        parts.append(line('Wiper', [(x0, -L / 2 + c['cowl'] + 0.05, car.top(c['cowl'] + 0.05) + 0.012),
                                    (x0 + 0.52, -L / 2 + c['cowl'] + 0.08, car.top(c['cowl'] + 0.08) + 0.012)], 0.007, M['Trim'], group=None))
    # bumper seams just ahead of the front arch and behind the rear one, cut into the paint
    for side in (1, -1):
        for s in (car.axles[0] - car.R - 0.07, car.axles[1] + car.R + 0.07):
            if 0 < s < L:
                parts.append(surface_line(car, 'Bumper seam', [(s, 4.6), (s, 6.2), (s, 7.7)], 0.003, M['Trim'], side=side))
    rear = Buf()
    s_a = max(c['side'][0], c['rf']) + 0.10
    s_b = min(c['side'][1], c.get('rr') or c.get('cab') or L) - 0.08
    mid = (s_a + s_b) / 2
    zl, zt = car.belt(mid) - 0.05, min(car.top(s_a), car.top(s_b)) - 0.08
    xi = car.hw(mid) - c['tumble'] - 0.07
    for sx in (1, -1):
        box(rear, (sx * xi, -L / 2 + mid, (zl + zt) / 2), (0.02, s_b - s_a, zt - zl), 'Trim')
    if c.get('rr') or c.get('cab'):
        h_a, h_b = c['rf'] + 0.10, (c.get('rr') or c['cab']) - 0.10
        box(rear, (0, -L / 2 + (h_a + h_b) / 2, min(car.top(h_a), car.top(h_b)) - 0.05), (2 * xi, h_b - h_a, 0.02), 'Trim')
    if c.get('rr') and c.get('rg'):
        last = c['cowl'] + (1.75 if c['seats'] > 1 else 0.95) + 0.10
        mid = (last + c['rg']) / 2
        box(rear, (0, -L / 2 + mid, car.belt(mid) - 0.03), (2 * car.hw(mid) - 0.14, c['rg'] - last, 0.02), 'Trim')
        if c['rg'] - c['rr'] < 0.6:
            rw = car.hw(c['rr']) - c['tumble']
            box(rear, (0, -L / 2 + c['rr'] + 0.06, car.top(c['rr']) + 0.008), (2 * rw * 0.80, 0.16, 0.024), 'Paint')
            box(rear, (0, -L / 2 + c['rr'] + 0.13, car.top(c['rr']) - 0.007), (0.36, 0.014, 0.012), 'TailLamp')
            parts.append(surface_line(car, 'Rear wiper', [(c['rg'] - 0.05, 14.0), (max(c['rr'] + 0.06, c['rg'] - 0.32), 12.9)], 0.006, M['Trim'], 0.012))
    if c.get('cab'):
        box(rear, (0, L / 2 + 0.006, car.top(L) - 0.08), (0.20, 0.010, 0.05), 'Trim')     # the tailgate handle
    if rear.f:
        parts.append(rear.obj(c['name'] + 'Rear', M))
    if c.get('rails'):
        for side in (1, -1):
            pts = [(s, 11.6) for s in (c['rf'] + 0.12, (c['rf'] + c['rr']) / 2, c['rr'] - 0.10)]
            parts.append(surface_line(car, 'Roof rail', pts, 0.016, M['Trim'], 0.035, side))
    if c.get('cab'):
        cab = c['cab']
        # the cab's back wall: its window, and the gap between cab and tub
        win = Buf()
        quad(win, -0.50, 0.50, car.belt(cab - 0.06) + 0.10, car.top(cab - 0.08) - 0.12, -L / 2 + cab - 0.006, 1, 'Glass')
        parts.append(win.obj('Cab window', M))
        for side in (1, -1):
            parts.append(surface_line(car, 'Tub gap', [(cab + 0.03, 4.4), (cab + 0.03, 6.0), (cab + 0.03, 7.9)], 0.005, M['Trim'], 0.0, side))
            parts.append(surface_line(car, 'Tailgate', [(L - 0.04, 4.6), (L - 0.04, 7.9)], 0.004, M['Trim'], 0.0, side))
        parts.append(cube('Rear step', (0, L / 2 + 0.035, car.bot(L) + 0.06), (1.30, 0.10, 0.12), M['Trim'], bevel=0.015, group=None))
    if c.get('van'):
        for side in (1, -1):
            parts.append(surface_line(car, 'Slide rail', [(c['doors'][2], 9.0), (c['doors'][3], 9.0), (L - 0.12, 9.0)], 0.012, M['Trim'], 0.004, side))
    # interior through the glass: dash, wheel, seats with head restraints
    hw = car.hw(c['cowl'] + 0.4)
    cs = c['cowl'] + 0.44
    dz = min(car.belt(cs), car.top(cs - 0.18) - 0.05) - 0.09        # its top 5 cm under the glass at its front edge
    parts.append(cube('Dash', (0, -L / 2 + cs, dz), (2 * hw - 0.10, 0.36, 0.18), M['Trim'], bevel=0, group=None))
    parts.append(ring('Steering wheel', (-0.37, -L / 2 + cs + 0.30, dz + 0.10), 0.18, 0.016, M['Trim'], axis='Y', group=None, segments=16))
    rows = [c['cowl'] + 0.95] + ([c['cowl'] + 1.75] if c['seats'] > 1 else [])
    for k, rs in enumerate(rows):
        z = car.belt(rs)
        for x in ((-0.38, 0.38) if k == 0 else (-0.42, 0.0, 0.42)):
            w = 0.50 if k == 0 else 0.42
            parts.append(cube('Seat back', (x, -L / 2 + rs, z - 0.12), (w, 0.12, 0.55), M['Trim'], bevel=0, group=None))
            parts.append(cube('Head restraint', (x, -L / 2 + rs - 0.02, z + 0.25), (0.26, 0.10, 0.18), M['Trim'], bevel=0, group=None))
    if c.get('van'):
        parts.append(cube('Bulkhead', (0, -L / 2 + c['cowl'] + 1.25, 1.0), (2 * car.hw(2.0) - 0.08, 0.03, 1.6), M['Trim'], bevel=0, group=None))
    root = join_group(c['name'], parts)
    # smooth panels, sharp creases (the bumper faces, the cab's back, lamp edges): glTF keeps the split normals
    bpy.ops.object.select_all(action='DESELECT'); root.select_set(True); bpy.context.view_layer.objects.active = root
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    root.select_set(False)
    root.location = at
    return root, car


def lathe(buf, profile, mat, segs):
    """Revolve [(x, radius)] about the axle (X), segs around; faces wound outward."""
    n = len(profile); o = len(buf.v)
    for x, rad in profile:
        for j in range(segs):
            a = math.tau * j / segs
            buf.v.append((x, rad * math.sin(a), rad * math.cos(a)))
    for p in range(n - 1):
        for j in range(segs):
            a, b, cc, d = o + p * segs + j, o + (p + 1) * segs + j, o + (p + 1) * segs + (j + 1) % segs, o + p * segs + (j + 1) % segs
            buf.f.append((a, d, cc, b)); buf.m.append(mat)


def build_wheel(c, M, name):
    """The left wheel (its face toward -X), centred on its hub: tyre with sidewalls and two grooves, alloy rim with spokes."""
    r, w, rr = c['r'], c['tw'], c['rim']
    buf = Buf(); h = w / 2
    # the tyre's section from the inner bead round the tread to the outer bead; +x is inboard
    tyre = [(h - 0.012, rr), (h, rr + 0.025), (h + 0.006, (rr + r) / 2), (h - 0.006, r - 0.03), (h - 0.03, r - 0.002),
            (0.30 * h, r), (0.26 * h, r - 0.008), (0.20 * h, r - 0.008), (0.16 * h, r),
            (-0.16 * h, r), (-0.20 * h, r - 0.008), (-0.26 * h, r - 0.008), (-0.30 * h, r),
            (-h + 0.03, r - 0.002), (-h + 0.006, r - 0.03), (-h - 0.006, (rr + r) / 2), (-h, rr + 0.025), (-h + 0.012, rr)]
    lathe(buf, tyre, 'Trim', 28)
    # rim: barrel and lip, dished face; behind the spokes a dark disc (the brake and hub shadow)
    face = -h + 0.03
    rim = [(h - 0.02, rr - 0.012), (-h + 0.014, rr - 0.012), (-h + 0.006, rr + 0.004), (-h + 0.002, rr - 0.004),
           (face, rr - 0.03), (face + 0.012, rr - 0.05)]
    lathe(buf, rim, 'Rim', 28)
    lathe(buf, [(face + 0.08, rr - 0.04), (face + 0.08, 0.0)], 'Trim', 24)
    lathe(buf, [(face + 0.06, 0.145), (face + 0.06, 0.075)], 'Rim', 24)       # the brake disc, 290 mm
    obj = buf.obj(name + 'Tyre', M)
    parts = [obj]
    n = c['spokes']
    for k in range(n):
        a = math.tau * k / n
        mid = (rr + 0.02) / 2
        sp = cube('Spoke', (face + 0.012, mid * math.sin(a), mid * math.cos(a)), (0.022, 0.034 if n >= 8 else 0.05, rr - 0.08), M['Rim'], bevel=0, group=None)
        sp.rotation_euler = (-a, 0, 0)
        bpy.context.view_layer.objects.active = sp; sp.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False); sp.select_set(False)
        parts.append(sp)
    parts.append(cylinder('Hub', (face + 0.008, 0, 0), 0.07, 0.03, M['Rim'], axis='X', group=None, segments=16))
    if n < 8:
        for k in range(5):
            a = math.tau * (k + 0.5) / 5
            parts.append(cylinder('Wheel nut', (face - 0.010, 0.05 * math.sin(a), 0.05 * math.cos(a)), 0.011, 0.016, M['Trim'], axis='X', group=None, segments=6))
    w_obj = join_group(name, parts)
    return w_obj


def build_all(start=0, paints=None):
    M = materials()
    roots = []
    for i, c in enumerate(CARS):
        root, car = build_body(c, M if not paints else {**M, 'Paint': paints[i]}, (0, 0, 0))
        L = c['L']
        tris = sum(len(p.vertices) - 2 for p in root.data.polygons)
        hubs = {}
        for suffix in WHEELS:
            front = 'Front' in suffix; left = suffix.endswith('L')
            hub = Vector(((-1 if left else 1) * c['track'] / 2, -L / 2 + car.axles[0 if front else 1], c['r']))
            w = build_wheel(c, M, c['name'] + suffix)
            if not left:
                # the right wheel is the left one turned half round about the vertical, face outboard
                for v in w.data.vertices: v.co.x, v.co.y = -v.co.x, -v.co.y
            w.parent = root
            w.location = hub
            hubs[suffix] = hub
        wt = sum(len(p.vertices) - 2 for p in root.children[0].data.polygons)
        xs = [v.co.x for v in root.data.vertices]; ys = [v.co.y for v in root.data.vertices]; zs = [v.co.z for v in root.data.vertices]
        print(f'EVERYDAY {c["name"]}: {tris} body triangles, wheels {wt} each, {len(root.data.materials)} body materials, '
              f'size {max(ys) - min(ys):.3f} x {max(xs) - min(xs):.3f} x {max(zs) - min(zs):.3f} m (incl. mirrors), '
              f'wheelbase {c["wb"]:.3f} track {c["track"]:.3f} tyre r {c["r"]:.3f}')
        root.location = ((start + i) * 6.0, 0, 0)
        roots.append(root)
    return roots


def preview(out):
    """Render the five vehicles together on a grey apron."""
    colours = [(.80, .80, .80), (.42, .44, .46), (.12, .13, .14), (.02, .04, .12), (.40, .015, .012)]
    paints = []
    for k, col in enumerate(colours):
        m = get_mat(f'PreviewPaint{k}', (*col, 1), .35, .30); paints.append(m)
    roots = build_all(0, paints)
    for k, r in enumerate(roots):
        r.location = (k * 2.6 - 5.2, k * 0.0, 0)
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    bpy.context.object.data.materials.append(get_mat('Apron', (.30, .30, .29, 1), 0, .8))
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = 1800, 1000
    world = bpy.data.worlds.new('Sky'); sc.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.55, .65, .8, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 3.5; sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); sc.collection.objects.link(cam); sc.camera = cam
    views = {'front': ((9.5, -11.5, 3.4), (0.5, 0, 0.8)), 'rear': ((-8.5, 12.0, 3.6), (-0.5, 0, 0.8)),
             'side': ((27.0, 0.0, 1.6), (0.0, 0, 0.9)), 'close': ((3.4, -5.6, 1.6), (0.9, -0.6, 0.7))}
    for name, (eye, look) in views.items():
        for k, r in enumerate(roots):
            r.location = (0, k * 6.2 - 12.4, 0) if name == 'side' else (k * 2.6 - 5.2, 0, 0)
        cam.location = eye
        d = Vector(look) - Vector(eye); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = 50 if name != 'side' else 28
        sc.render.filepath = str(Path(out) / f'everyday-{name}.png')
        bpy.ops.render.render(write_still=True)
        print('PREVIEW', sc.render.filepath)


if __name__ == '__main__':
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    out = os.environ.get('TW_PREVIEW')
    if out:
        Path(out).mkdir(parents=True, exist_ok=True)
        preview(out)
    else:
        build_all()
