# Blender half of tools/rally/import_gt3rs_zry.mjs: reads the GT3RS ZRY studio blend (read only) and
# writes every visible car triangle, in game axes, with game materials and the side-graphic texture.
#   blender -b <car.blend> --factory-startup -P tools/rally/gt3rs_zry_export.py -- <out-dir> <side-graphic.png>
# Blender axes: X rearward from the front axle, Y to the car's right, Z up, road at Z = 0.
# Game axes: metres, +Y up, +Z forward, origin on the road midway between the axles, so
#   game (x, y, z) = (-Y, Z, 1.2285 - X) for the 2.457 m wheelbase.
import bpy, sys, os, json, math, re
import numpy as np

OUT, GRAPHIC = sys.argv[sys.argv.index('--') + 1:][:2]
os.makedirs(OUT, exist_ok=True)
MID = 2.457 / 2
R3 = np.array([[0, -1, 0], [0, 0, 1], [-1, 0, 0]], dtype=np.float64)   # Blender -> game rotation (det +1)

sc = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()
roots = [o for o in sc.objects if o.type == 'EMPTY' and o.parent is None]
car = max(roots, key=lambda o: len(o.children_recursive))
STEER = {'Steering / left': 'Front left', 'Steering / right': 'Front right'}
# The physics numbers its negative-X (car's right, Blender +Y) wheel first; the maker calls it right.
CORNER_NODE = {'Front right': 'WheelFrontL', 'Front left': 'WheelFrontR', 'Rear right': 'WheelRearL', 'Rear left': 'WheelRearR'}
TRACK = {'Front': 0.815, 'Rear': 0.791}

# ------------------------------------------------------------------ materials
def lin_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

_image_mean = {}
def image_mean(img):
    if img is None: return (0.5, 0.5, 0.5)
    if img.name not in _image_mean:
        try:
            n = img.size[0] * img.size[1]
            if n == 0: raise ValueError
            px = np.empty(n * 4, dtype=np.float32); img.pixels.foreach_get(px)
            px = px.reshape(-1, 4)
            rgb = px[:, :3]
            if not img.is_float and img.colorspace_settings.name == 'sRGB':
                rgb = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
            _image_mean[img.name] = tuple(float(x) for x in rgb.mean(0))
        except Exception:
            _image_mean[img.name] = (0.5, 0.5, 0.5)
    return _image_mean[img.name]

def socket_value(s, depth=0):
    """A representative constant for a socket: its default, or the mean of what drives it."""
    if s is None: return None
    if not s.is_linked or depth > 8:
        v = s.default_value
        try: return tuple(v)[:3]
        except TypeError: return float(v)
    link = s.links[0]; n = link.from_node; t = n.type
    def inp(*names):
        for name in names:
            for i in n.inputs:
                if i.name == name and i.enabled: return i
        return None
    def num(x):
        return x if isinstance(x, float) else sum(x) / 3
    def col(x):
        return x if isinstance(x, tuple) else (x, x, x)
    if t == 'RGB': return tuple(n.outputs[0].default_value)[:3]
    if t == 'VALUE': return n.outputs[0].default_value
    if t == 'VALTORGB':   # the ramp's mean over its input range
        samples = [n.color_ramp.evaluate((i + 0.5) / 64) for i in range(64)]
        c = tuple(sum(s[k] for s in samples) / 64 for k in range(3))
        return sum(s[3] for s in samples) / 64 if link.from_socket.name == 'Alpha' else c
    if t == 'TEX_IMAGE':
        m = image_mean(n.image)
        return 1.0 if link.from_socket.name == 'Alpha' else m
    if t in ('MIX_RGB', 'MIX'):
        f = socket_value(inp('Fac', 'Factor'), depth + 1)
        f = 0.5 if f is None else num(f)
        a = socket_value(inp('Color1', 'A'), depth + 1); b = socket_value(inp('Color2', 'B'), depth + 1)
        if a is None or b is None: return a if b is None else b
        a, b = col(a), col(b)
        blend = getattr(n, 'blend_type', 'MIX')
        if blend == 'MULTIPLY': b = tuple(a[k] * b[k] for k in range(3))
        elif blend == 'ADD': b = tuple(a[k] + b[k] for k in range(3))
        elif blend == 'SCREEN': b = tuple(1 - (1 - a[k]) * (1 - b[k]) for k in range(3))
        elif blend == 'OVERLAY': b = tuple(2 * a[k] * b[k] if a[k] < 0.5 else 1 - 2 * (1 - a[k]) * (1 - b[k]) for k in range(3))
        return tuple(a[k] * (1 - f) + b[k] * f for k in range(3))
    if t == 'MAP_RANGE':
        lo = socket_value(inp('To Min'), depth + 1); hi = socket_value(inp('To Max'), depth + 1)
        return (num(lo) + num(hi)) / 2
    for i in n.inputs:
        if i.enabled and i.type in ('RGBA', 'VALUE', 'VECTOR'):
            return socket_value(i, depth + 1)
    return 0.5

def principled(mat):
    if not (mat.use_nodes and mat.node_tree): return None
    nodes = mat.node_tree.nodes
    out = next((n for n in nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
    def find(n, depth=0):
        if n is None or depth > 6: return None
        if n.type == 'BSDF_PRINCIPLED': return n
        if n.type in ('MIX_SHADER', 'ADD_SHADER'):
            for i in n.inputs:
                if i.type == 'SHADER' and i.is_linked:
                    r = find(i.links[0].from_node, depth + 1)
                    if r: return r
        return None
    p = find(out.inputs['Surface'].links[0].from_node) if out and out.inputs['Surface'].is_linked else None
    return p or next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)

def source_pbr(mat):
    p = principled(mat)
    if p is None:
        c = tuple(mat.diffuse_color)[:3]
        return dict(color=c, metal=0.0, rough=0.5, emissive=(0, 0, 0), coat=0.0)
    g = lambda k: socket_value(p.inputs.get(k))
    c = g('Base Color'); c = c if isinstance(c, tuple) else (c, c, c)
    num = lambda x, d: d if x is None else (x if isinstance(x, float) else sum(x) / 3)
    e = g('Emission Color'); es = num(g('Emission Strength'), 0.0)
    e = e if isinstance(e, tuple) else (e, e, e)
    return dict(color=c, metal=num(g('Metallic'), 0.0), rough=num(g('Roughness'), 0.5),
                emissive=tuple(min(1.0, x * es) for x in e), coat=num(g('Coat Weight'), 0.0))

GLASS = {'Laminated windscreen | neutral solar', 'Door drop glass | neutral solar', 'Heated backlight | grey solar',
         'Fixed quarter glass | grey solar', 'Glazing | laminated ceramic optical stack', 'Cabin | glass'}
LAMP_GLASS = {'Headlamp / hardcoated clear cover', 'Headlamp / optical crown glass', 'Rear lamp | hardcoated clear shell'}
HEAD_LED = {'Headlamp / illuminated LED exit', 'Headlamp / opal exit face'}
TAIL_LED = re.compile(r'^(Rear lamp \| (ruby light guide|ruby socket \d+|ruby termination emitter \d+|deep ruby lens)|High stop lens \| lightly smoked acrylic)$')
LAMP_PART = re.compile(r'^(Headlamp|Rear lamp|Front DRL|Stop lamp|High stop lens|Side marker)\b')
RED_WHEEL = dict(color=(0.40, 0.022, 0.035), metal=0.72, rough=0.30, emissive=(0, 0, 0), coat=0.0)
WHEEL = {'Wheel | satin black forged alloy': RED_WHEEL, 'Wheel | diamond-cut black lacquer lip': RED_WHEEL,
         'Wheel | dark graphite barrel': dict(color=(0.22, 0.014, 0.022), metal=0.6, rough=0.4, emissive=(0, 0, 0), coat=0.0)}
PAINT_WHITE = (0.80, 0.80, 0.79)
SIDE_RED = (0.36, 0.010, 0.022)
FIXED = {   # game materials with names other game code keys on (Damage.js, CarLights.js)
    'BodyPaint': dict(color=PAINT_WHITE, metal=0.0, rough=0.38, coat=1.0, coatRough=0.025),
    'BodyPaintVinyl': dict(color=PAINT_WHITE, metal=0.0, rough=0.38, coat=1.0, coatRough=0.025, texture='vinyl'),
    'GlassClear': dict(color=(0.025, 0.030, 0.034), alpha=0.22, metal=0.0, rough=0.04, coat=1.0, coatRough=0.02, single=True),
    'GlassLampCover': dict(color=(0.266, 0.269, 0.274), alpha=0.085, metal=0.13, rough=0.054, coat=1.0, coatRough=0.035, single=True),
    'HeadlampLED': dict(color=(0.90, 0.94, 1.0), metal=0.06, rough=0.115, emissive=(0.80, 0.88, 1.0), coat=0.65),
    'TailLampLED': dict(color=(0.43, 0.003, 0.009), metal=0.08, rough=0.22, emissive=(0.25, 0.00075, 0.00225), coat=0.4),
}

def game_material(mat):
    """(game name, params) for a source material. Plain names avoid the words other code keys on."""
    name = mat.name if mat else '-'
    base = re.sub(r'\.\d{3}$', '', name)
    if base.startswith('Paint |'): return 'BodyPaint', None
    if base in GLASS: return 'GlassClear', None
    if base in LAMP_GLASS: return 'GlassLampCover', None
    if base in HEAD_LED: return 'HeadlampLED', None
    if TAIL_LED.match(base): return 'TailLampLED', None
    p = WHEEL.get(base) or (source_pbr(mat) if mat else dict(color=(0.5, 0.5, 0.5), metal=0, rough=0.5, emissive=(0, 0, 0), coat=0))
    # Damage.js sorts parts by words in the material name (plate, lamp/led/lens/light/indicator,
    # glass/window, paint) and CarLights.js lights headlamp/taillamp names: every other name spells
    # those words short, so a 'molded' trim or a 'plate lamp' seal stays body.
    lamp = LAMP_PART.match(base)
    words = re.sub(r'^(Headlamp /|Rear lamp \||Front DRL \||Stop lamp \||High stop lens \||Side marker \|)', lambda m: {
        'Headlamp /': 'Head', 'Rear lamp |': 'Rear', 'Front DRL |': 'DRL', 'Stop lamp |': 'Stop', 'High stop lens |': 'Stop', 'Side marker |': 'Marker'}[m.group(1)], base)
    for word, short in (('lamp', 'Lmp'), ('led', 'Ld'), ('lens', 'Lns'), ('indicator', 'Indic'), ('light', 'Lt'),
                        ('glass', 'Gls'), ('window', 'Wnd'), ('paint', 'Pnt'), ('plate', 'Plt')):
        words = re.sub('(?i)' + word, short, words)
    prefix = 'Lamp_' if lamp else ''
    clean = re.sub(r'[^A-Za-z0-9]+', '_', words).strip('_')
    return prefix + clean, p

def quantise(p, target):
    # Look-alike finishes share one draw: steps of 1/12 in sRGB colour (1/6 in the cabin, seen through
    # glass), roughness in fifths and metal in halves.
    steps = 6 if target == 'cabin' else 12
    s = [lin_to_srgb(c) for c in p['color']]
    return (tuple(round(x * steps) for x in s), round(p['metal'] * 2), round(p['rough'] * 5), round(p.get('coat', 0)),
            tuple(round(lin_to_srgb(x) * 4) for x in p.get('emissive', (0, 0, 0))))

materials, material_index, merged = [], {}, {}
def material_id(mat, target):
    """Game material id; plain materials with the same look in the same part of the car share one."""
    key0 = (mat.name if mat else '-', target)
    if key0 in material_index: return material_index[key0]
    name, p = game_material(mat)
    if p is None:
        key = ('fixed', name)
        params = FIXED[name]
    else:
        # wheel finishes stay apart: few, and the tests find the disc, tyre and calliper by name
        key = (name.startswith('Lamp_'), target, quantise(p, target), name if target == 'wheel' else None)
        params = dict(color=p['color'], metal=p['metal'], rough=p['rough'], emissive=p.get('emissive', (0, 0, 0)), coat=min(1.0, p.get('coat', 0.0)), coatRough=0.05)
    if key not in merged:
        merged[key] = len(materials)
        materials.append(dict(name=name, **params, sources=[]))
    i = merged[key]
    materials[i]['sources'].append(key0[0])
    material_index[key0] = i
    return i

# ------------------------------------------------------------------ objects
def collections_of(o):
    return {re.sub(r'\.\d{3}$', '', c.name) for c in o.users_collection}

def corner_of(o):
    a = o
    while a is not None:
        if a.name in STEER: return STEER[a.name]
        a = a.parent
    m = re.match(r'^(Rear (left|right)) ', o.name)
    if m:
        mw = np.array(o.matrix_world)
        c = mw[:3, 3]
        bb = np.array([mw[:3, :3] @ np.array(v) + c for v in o.bound_box])
        mid = (bb.min(0) + bb.max(0)) / 2
        if abs(mid[0] - 2.457) < 0.45 and abs(mid[2] - 0.36) < 0.45 and abs(mid[1]) > 0.55: return m.group(1)
    return None

def evaluated(o):
    e = o.evaluated_get(dg)
    me = e.to_mesh()
    if me is None: return None
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    if nt == 0:
        e.to_mesh_clear(); return None
    nv, nl = len(me.vertices), len(me.loops)
    co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    lv = np.empty(nl, dtype=np.int64); me.loops.foreach_get('vertex_index', lv)
    ln = np.empty(nl * 3); me.corner_normals.foreach_get('vector', ln); ln = ln.reshape(-1, 3)
    tl = np.empty(nt * 3, dtype=np.int64); me.loop_triangles.foreach_get('loops', tl); tl = tl.reshape(-1, 3)
    tm = np.empty(nt, dtype=np.int64); me.loop_triangles.foreach_get('material_index', tm)
    mats = list(me.materials) or [None]
    e.to_mesh_clear()
    M = np.array(o.matrix_world)
    A = M[:3, :3]
    P = co @ A.T + M[:3, 3]
    N = ln @ np.linalg.inv(A)          # inverse-transpose for normals
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    if np.linalg.det(A) < 0: tl = tl[:, ::-1]
    return P, lv, N, tl, np.clip(tm, 0, len(mats) - 1), mats

# ------------------------------------------------------------------ wheels: hub axis and round tyres
def circle_fit(v, axis):
    e1 = np.array([1.0, 0, 0]); e1 -= axis * (e1 @ axis); e1 /= np.linalg.norm(e1); e2 = np.cross(axis, e1)
    p = np.c_[v @ e1, v @ e2]; c = p.mean(0)
    for _ in range(6):
        d = p - c; ang = np.arctan2(d[:, 1], d[:, 0]); r = np.hypot(*d.T)
        k = ((ang + math.pi) / (2 * math.pi) * 720).astype(int) % 720
        order = np.lexsort((r, k)); last = np.r_[k[order][1:] != k[order][:-1], True]
        Q = p[order[last]]
        for keep in (np.ones(len(Q), bool), None):
            if keep is None:
                dev = np.hypot(*(Q - c).T) - R; keep = dev > np.percentile(dev, 25)
            A = np.c_[2 * Q[keep], np.ones(keep.sum())]; b = (Q[keep] ** 2).sum(1)
            s = np.linalg.lstsq(A, b, rcond=None)[0]; c = s[:2]; R = math.sqrt(s[2] + c @ c)
    centre = c[0] * e1 + c[1] * e2 + axis * float((v @ axis).mean())
    return centre, R

def seam_angle(d, e1, e2):
    """Angle of the tyre's vertex column nearest the horizontal (the tyre is a revolution of columns)."""
    phi = np.arctan2(d @ e2, d @ e1)
    near = phi[np.abs(phi) < math.radians(3)]
    if not len(near): return 0.0
    bins = np.round(near / 2e-4).astype(np.int64)
    vals, counts = np.unique(bins, return_counts=True)
    return float(np.median(near[bins == vals[counts.argmax()]]))

def refine_centre(P, axis, c):
    """The columns either side of the axle are mirror images: their mean is the true centre (the
    loaded flat biases a circle fit)."""
    e1 = np.array([1.0, 0, 0]); e1 -= axis * (e1 @ axis); e1 /= np.linalg.norm(e1); e2 = np.cross(axis, e1)
    for _ in range(3):
        d = P - c
        pc = seam_angle(d, e1, e2)
        f1, f2 = math.cos(pc) * e1 + math.sin(pc) * e2, -math.sin(pc) * e1 + math.cos(pc) * e2
        a = np.arctan2(d @ f2, d @ f1)
        cols = (np.abs(a) < math.radians(0.4)) | (np.abs(np.abs(a) - math.pi) < math.radians(0.4))
        q = d[cols]
        c = c + f1 * float((q @ f1).mean()) + f2 * float((q @ f2).mean())
    return c

hubs = {}
for corner in CORNER_NODE:
    tyre = sc.objects[corner + ' Cup tyre']
    P = evaluated(tyre)[0]
    X = P - P.mean(0); w, U = np.linalg.eigh(X.T @ X); axis = U[:, 0]
    if axis[1] * (1 if 'right' in corner else -1) < 0: axis = -axis     # outward
    centre, R = circle_fit(P, axis)
    centre = refine_centre(P, axis, centre)
    d = P - centre; radial = np.linalg.norm(d - np.outer(d @ axis, axis), axis=1)
    R = float(radial[d[:, 2] > 0].max())                                # unloaded radius, from the upper half
    y = TRACK[corner.split()[0]] * (1 if 'right' in corner else -1)
    hub = centre + axis * ((y - centre[1]) / axis[1])                   # on the axle at the physics track
    camber = math.degrees(math.asin(abs(axis[2])))
    hubs[corner] = dict(axis=axis, centre=centre, hub=hub, R=R, camber=camber, ground=float(P[:, 2].min()))

def solid_disc(P, corner, segments=96):
    """The cross-drilled disc's holes cannot survive the triangle budget, and clustering them leaves a
    ragged disc. A solid disc of the same inner and outer radius and thickness, on the same axle."""
    h = hubs[corner]; axis, c = h['axis'], h['centre']
    d = P - c; a = d @ axis; r = np.linalg.norm(d - np.outer(a, axis), axis=1)
    r0, r1, a0, a1 = float(r.min()), float(r.max()), float(a.min()), float(a.max())
    e1 = np.array([1.0, 0, 0]); e1 -= axis * (e1 @ axis); e1 /= np.linalg.norm(e1); e2 = np.cross(axis, e1)
    th = np.linspace(0, 2 * math.pi, segments, endpoint=False)
    ring = np.outer(np.cos(th), e1) + np.outer(np.sin(th), e2)
    V, NN, T = [], [], []
    def band(pa, pb, na, nb, flip):
        base = sum(len(v) for v in V)
        V.extend([pa, pb]); NN.extend([na, nb])
        for i in range(segments):
            j = (i + 1) % segments
            q = [base + i, base + segments + i, base + segments + j, base + j]
            T.extend([[q[0], q[1], q[2]], [q[0], q[2], q[3]]] if not flip else [[q[0], q[2], q[1]], [q[0], q[3], q[2]]])
    ax = np.tile(axis, (segments, 1))
    band(c + ring * r0 + axis * a1, c + ring * r1 + axis * a1, ax, ax, False)            # outboard face
    band(c + ring * r0 + axis * a0, c + ring * r1 + axis * a0, -ax, -ax, True)           # inboard face
    band(c + ring * r1 + axis * a0, c + ring * r1 + axis * a1, ring, ring, False)        # outer edge
    band(c + ring * r0 + axis * a0, c + ring * r0 + axis * a1, -ring, -ring, True)       # inner edge
    Pn = np.vstack(V); Nn = np.vstack(NN); tl = np.array(T, dtype=np.int64)
    # outward winding check against the stored normals
    f = np.cross(Pn[tl[:, 1]] - Pn[tl[:, 0]], Pn[tl[:, 2]] - Pn[tl[:, 0]])
    flip = (f * Nn[tl[:, 0]]).sum(1) < 0
    tl[flip] = tl[flip][:, ::-1]
    print(f'  solid disc {corner}: r {r0:.4f}..{r1:.4f} m, {1000 * (a1 - a0):.1f} mm thick, {len(tl)} tris')
    return Pn, np.arange(len(Pn)), Nn, tl

def round_tyre(P, lv, N, tl, corner, name):
    """The studio tyre is modelled loaded: flat on the road. A game wheel spins, so its lower half is
    replaced by the upper half turned 180 degrees about the axle (islands whole, faces at the seam)."""
    h = hubs[corner]; axis, c = h['axis'], h['centre']
    e1 = np.array([1.0, 0, 0]); e1 -= axis * (e1 @ axis); e1 /= np.linalg.norm(e1); e2 = np.cross(axis, e1)
    if e2[2] < 0: e2 = -e2
    d = P - c
    pc = seam_angle(d, e1, e2)
    e1, e2 = math.cos(pc) * e1 + math.sin(pc) * e2, -math.sin(pc) * e1 + math.cos(pc) * e2
    up = d @ e2
    # rotation by 180 degrees about the axle: v -> c + 2 (d.a) a - d
    rot = lambda q: c + 2 * np.outer((q - c) @ axis, axis) - (q - c)
    rotn = lambda n: 2 * np.outer(n @ axis, axis) - n
    tv = lv[tl]                                            # triangle vertex ids
    # islands by shared vertices
    parent = np.arange(len(P))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for a, b, cc in tv:
        ra, rb, rc = find(a), find(b), find(cc)
        parent[rb] = ra; parent[find(rc)] = ra
    isl = np.array([find(i) for i in range(len(P))])[tv[:, 0]]
    n_isl = len(set(isl.tolist()))
    if n_isl > 4:
        cen = {}
        for t, i in enumerate(isl): cen.setdefault(i, []).append(t)
        keep = np.zeros(len(tl), bool)
        for i, ts in cen.items():
            if up[tv[ts].ravel()].mean() > 0: keep[ts] = True
    else:
        keep = (up[tv] >= -3e-4).all(1)
    seam = np.abs(up) < 3e-4
    kv = np.unique(tv[keep])
    newP = np.vstack([P, rot(P[kv])]); remap = np.full(len(P), -1); remap[kv] = len(P) + np.arange(len(kv))
    # weld turned seam vertices onto the original seam
    gap = 0.0
    if n_isl <= 4 and seam.any():
        S = np.where(seam)[0]
        for j, v in enumerate(kv):
            if seam[v]:
                q = newP[len(P) + j]; dd = np.linalg.norm(P[S] - q, axis=1); k = dd.argmin()
                gap = max(gap, float(dd[k])); newP[len(P) + j] = P[S[k]]
    # loops: duplicate the kept triangles' loops onto the turned vertices
    kt = tl[keep]
    nl0 = len(lv)
    loops = np.unique(kt)
    lremap = np.full(nl0, -1); lremap[loops] = nl0 + np.arange(len(loops))
    newlv = np.r_[lv, remap[lv[loops]]]
    newN = np.vstack([N, rotn(N[loops])])
    newtl = np.vstack([kt, lremap[kt]])
    print(f'  round {corner} {name}: {n_isl} islands, kept {keep.sum()} of {len(tl)} tris, seam weld {gap * 1000:.3f} mm')
    return newP, newlv, newN, newtl, keep

# ------------------------------------------------------------------ export
STUDIO = re.compile(r'^06 ')
# Perforated sheets (bonnet vent meshes, grille screen, airbox honeycomb, punched door inserts): thousands of
# separate cells no reduction can keep. Each sits over a dark moulded well, which reads the same from the
# chase camera, so the sheet is left out.
PERFORATED = re.compile(r'(?i)discharge mesh|hexagonal mesh|honeycomb|perforated black insert|perforation scrim')
dropped = []
index = []
blob = open(os.path.join(OUT, 'zry.bin'), 'wb')
offset = 0
stats = {}
for o in sc.objects:
    if o.type not in ('MESH', 'CURVE', 'FONT', 'SURFACE'): continue
    if not o.visible_get() or o.hide_render: continue
    cols = collections_of(o)
    if any(STUDIO.match(c) for c in cols): continue
    if PERFORATED.search(o.name): dropped.append(o.name); continue
    ev = evaluated(o)
    if ev is None: continue
    P, lv, N, tl, tm, mats = ev
    corner = corner_of(o)
    if corner:
        target = 'wheel'
        part = 'fixed' if 'caliper' in o.name.lower() else 'roll'
        if 'cross-drilled brake disc' in o.name:
            P, lv, N, tl = solid_disc(P, corner)
            tm = np.zeros(len(tl), dtype=np.int64)
        elif part == 'roll' and P[:, 2].min() < 0.002:
            P, lv, N, tl, keep = round_tyre(P, lv, N, tl, corner, o.name)
            tm = np.r_[tm[keep], tm[keep]]
    else:
        part = None
        c0 = P.min(0); c1 = P.max(0)
        wingish = '03  /  Wheels, brakes and DRS' in cols and c0[0] > 2.88 and c0[2] > 0.93 and not re.search(r'(?i)stop|lamp|lid|plinth|lens|reflector|airbox', o.name)
        target = 'wing' if wingish else 'cabin' if ('05  /  Cockpit' in cols or o.name.startswith('R15 ')) else 'body'
    # one game vertex per (source vertex, corner normal, material)
    tri_mat = np.array([material_id(mats[i], target) for i in tm], dtype=np.int64)
    # per-triangle target: exterior glazing goes to GlassPanels
    glassy = np.array([materials[m]['name'] in ('GlassClear',) for m in tri_mat]) if target == 'body' else np.zeros(len(tl), bool)
    loop_mat = np.zeros(len(lv), dtype=np.int64); loop_mat[tl.ravel()] = np.repeat(tri_mat, 3)
    qn = np.round(N * 4096).astype(np.int64)
    key = np.c_[lv, qn, loop_mat]
    used = np.unique(tl.ravel())
    uk, inv = np.unique(key[used], axis=0, return_inverse=True)
    inv = inv.ravel()
    lmap = np.full(len(lv), -1); lmap[used] = inv
    first = np.zeros(len(uk), dtype=np.int64); first[inv] = used
    VP = np.c_[-P[lv[first], 1], P[lv[first], 2], MID - P[lv[first], 0]]
    VN = N[first] @ R3.T
    I = lmap[tl].astype(np.uint32)
    # BodyPaint faces under the side graphic take the vinyl material (film: x 0.530..2.028 m behind the
    # front axle, z 0.235 + 0.017 u .. +0.206, |y| > 0.62, side-facing normals).
    paint = [i for i, m in enumerate(materials) if m['name'] == 'BodyPaint']
    if paint:
        tp = np.isin(tri_mat, paint)
        if tp.any():
            C = P[lv[tl]]                      # tri corners, Blender axes
            u = (C[..., 0] - 0.530) / 1.498
            v = (C[..., 2] - (0.235 + 0.017 * u)) / 0.206
            inside = ((u > -0.02) & (u < 1.02) & (v > -0.05) & (v < 1.05)).any(1)
            fn = np.cross(C[:, 1] - C[:, 0], C[:, 2] - C[:, 0]); fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
            side = (np.abs(C[..., 1]).mean(1) > 0.62) & (np.abs(fn[:, 1]) > 0.20)
            vin = tp & inside & side
            stats['vinyl_tris'] = stats.get('vinyl_tris', 0) + int(vin.sum())
            stats['vinyl_rejected_facing'] = stats.get('vinyl_rejected_facing', 0) + int((tp & inside & (np.abs(C[..., 1]).mean(1) > 0.62) & ~side).sum())
            if vin.any():
                key0 = ('<vinyl>', target)
                if key0 not in material_index:
                    material_index[key0] = len(materials); materials.append(dict(name='BodyPaintVinyl', **FIXED['BodyPaintVinyl'], sources=['Paint (side graphic)']))
                tri_mat = tri_mat.copy(); tri_mat[vin] = material_index[key0]
                # split the vertices of vinyl faces so each vertex belongs to one material
                loop_mat[tl.ravel()] = np.repeat(tri_mat, 3)
                key = np.c_[lv, qn, loop_mat]
                uk, inv = np.unique(key[used], axis=0, return_inverse=True); inv = inv.ravel()
                lmap = np.full(len(lv), -1); lmap[used] = inv
                first = np.zeros(len(uk), dtype=np.int64); first[inv] = used
                VP = np.c_[-P[lv[first], 1], P[lv[first], 2], MID - P[lv[first], 0]]
                VN = N[first] @ R3.T
                I = lmap[tl].astype(np.uint32)
    VP = np.ascontiguousarray(VP, dtype=np.float32); VN = np.ascontiguousarray(VN, dtype=np.float32)
    I = np.ascontiguousarray(I.ravel()); TM = np.ascontiguousarray(tri_mat, dtype=np.uint16); TG = np.ascontiguousarray(glassy, dtype=np.uint8)
    rec = dict(name=o.name, target=target, corner=corner, part=part, verts=len(VP), tris=len(TM), offset=offset)
    for arr in (VP, VN, I, TM, TG):
        b = arr.tobytes(); blob.write(b); offset += len(b)
        pad = (-offset) % 4; blob.write(b'\0' * pad); offset += pad
    index.append(rec)
    stats[target] = stats.get(target, 0) + len(TM)
blob.close()

# ------------------------------------------------------------------ side graphic texture (from the car's own graphic file)
src = bpy.data.images.load(GRAPHIC, check_existing=False)
W, H, MU, MV = 4096, 640, 0.012, 0.06
gw, gh = int(round(W / (1 + 2 * MU))), int(round(H / (1 + 2 * MV)))
src.scale(gw, gh)
g = np.empty(gw * gh * 4, dtype=np.float32); src.pixels.foreach_get(g); alpha = g.reshape(gh, gw, 4)[..., 3]
mask = np.zeros((H, W), dtype=np.float32)
x0, y0 = (W - gw) // 2, (H - gh) // 2
mask[y0:y0 + gh, x0:x0 + gw] = np.clip(alpha, 0, 1)
ratio = np.array(SIDE_RED) / np.array(PAINT_WHITE)
lin = 1 + mask[..., None] * (ratio - 1)
srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
px = np.dstack([srgb, np.ones((H, W, 1))]).astype(np.float32)
img = bpy.data.images.new('zry_vinyl', W, H, alpha=True)
img.colorspace_settings.name = 'Non-Color'
img.pixels.foreach_set(px.ravel())
img.filepath_raw = os.path.join(OUT, 'zry_vinyl.png'); img.file_format = 'PNG'; img.save()

hub_out = {CORNER_NODE[k]: dict(
    hub=[float(-h['hub'][1]), float(h['hub'][2]), float(MID - h['hub'][0])],
    axis=[float(-h['axis'][1]), float(h['axis'][2]), float(-h['axis'][0])],
    radius=h['R'], camber_deg=h['camber'], source=k, flat_mm=1000 * (h['R'] - (h['centre'][2] - h['ground']))) for k, h in hubs.items()}
json.dump(dict(objects=index, materials=materials, hubs=hub_out, stats=stats,
               vinyl=dict(width=W, height=H, mu=MU, mv=MV, u0=0.530, du=1.498, z0=0.235, rise=0.017, dz=0.206, mid=MID)),
          open(os.path.join(OUT, 'zry.json'), 'w'), indent=1)
print('left out (perforated sheets):', '; '.join(dropped))
print('ZRY export', len(index), 'objects', sum(r['tris'] for r in index), 'triangles', len(materials), 'materials', json.dumps(stats))
for k, h in hub_out.items(): print('HUB', k, json.dumps(h))
