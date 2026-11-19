"""Build the Ridgeback 4x4 (file black_jeep) in Blender, plus editable source and QA renders.
Reference: a lifted two-door body-on-frame off-roader on 37-inch mud tyres (0.94 m, r 0.47 m),
wheelbase 2.76 m, track 2.04 m, 2100 kg; a class, not one maker's model (no brand shapes or badges).
Z-up / -Y nose in Blender; Y-up / +Z nose in the exported game GLB. Origin on the ground under the
body centre; pivots WheelFrontL/R, WheelRearL/R at the hubs (z 0.47 m) and RearSpare on the tailgate
carrier. Vehicles.js and rally-physics vehicle.rs hold these numbers: change them together or not at all.
Run: Blender --background --factory-startup --python tools/rally/build_black_jeep.py [-- --no-render]
(--no-render skips the studio renders, which overwrite the tracked previews.)
(2026-10-06, ledger -3 "boxy, toy-like, cartoon round lamps, slab bonnet"): lofted bonnet
with a crowned centre and character lines, lamp units with a chrome reflector bowl, clear lens,
small projector and a thin running ring, rolled-lip arch flares, a winged steel bumper with
recovery tabs, a wrapped rear bumper with tabs and a hitch receiver, a sports bar behind the
front seats and the spare on a carrier clear of the tailgate (it sat 11 cm inside it).
"""
from pathlib import Path
import json, math, struct, sys
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from blender_primitives import material, mesh, cube, line, ring, cylinder, join_group, lettering, groups

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets/rally"
PREVIEW = OUT / "previews"
GAME = ROOT / "public/rally"
for p in (OUT, PREVIEW, GAME): p.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

black = material("ObsidianBlackPaint", (.013, .017, .019), .58, .29)
black.node_tree.nodes.get("Principled BSDF").inputs["Coat Weight"].default_value = .36
black.node_tree.nodes.get("Principled BSDF").inputs["Coat Roughness"].default_value = .20
satin = material("SatinBlackSteel", (.019,.023,.026), .42, .42)
trim = material("TexturedBlackTrim", (.012,.015,.017), .05, .68)
rubber = material("MudTerrainRubber", (.009,.011,.012), .02, .82)
lugmat = material("RaisedTreadLugs", (.016,.019,.020), .01, .76)
alloy = material("DarkGunmetalBeadlock", (.07,.078,.084), .88, .32)
bolt = material("TitaniumHardware", (.32,.36,.38), .9, .27)
steel = material("SuspensionSteel", (.07,.075,.08), .7, .38)
red = material("RecoveryRed", (.48,.018,.01), .38, .32)
amber = material("MarkerAmber", (.85,.24,.012), .18, .23, .22)
lamp = material("LEDLens", (.72,.83,.89), .18, .16, .35)
tail = material("RearLED", (.39,.007,.008), .22, .21, .16)
glass = material("SmokedGlass", (.038,.064,.074,.72), .15, .14)
glass.node_tree.nodes.get("Principled BSDF").inputs["Alpha"].default_value=.72
glass.surface_render_method="DITHERED"
interior=material("CabinCharcoal",(.021,.025,.028),.02,.88)
seat=material("StitchedSeats",(.065,.07,.073),.02,.86)
spring=material("CoilSpring",(.075,.085,.09),.72,.34)
plate=material("PlateWhite",(.66,.68,.65),.04,.58)
chrome=material("LampReflectorChrome",(.80,.82,.84),1.0,.07)
lens=material("ClearLampLens",(.86,.90,.93,.20),.0,.03)
lens.node_tree.nodes.get("Principled BSDF").inputs["Alpha"].default_value=.20
lens.surface_render_method="DITHERED"

def lathe(name, centre, profile, mat, group="BodyStatic", segments=40, smooth=True):
    """Revolve (radius, dy) pairs about a Y-parallel axis through centre: lamp bowls and lenses.
    A radius of 0 is a pole (one vertex, a triangle fan)."""
    cx, cy, cz = centre
    verts, faces, rings = [], [], []
    for r, dy in profile:
        if r < 1e-6:
            rings.append([len(verts)])
            verts.append((cx, cy + dy, cz))
            continue
        start = len(verts)
        for i in range(segments):
            a = math.tau * i / segments
            verts.append((cx + r * math.sin(a), cy + dy, cz + r * math.cos(a)))
        rings.append(list(range(start, start + segments)))
    for a, b in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            if len(a) == 1:
                faces.append((a[0], b[j], b[i]))
            elif len(b) == 1:
                faces.append((a[i], a[j], b[0]))
            else:
                faces.append((a[i], a[j], b[j], b[i]))
    return mesh(name, verts, faces, mat, group, smooth)

def loft(name, sections, mat, group="BodyStatic", sharp=32):
    """Quads between equal-length point rows, both ends capped (each end row lies in one plane)."""
    n = len(sections[0])
    verts = [p for s in sections for p in s]
    faces = [(k*n+i, (k+1)*n+i, (k+1)*n+i+1, k*n+i+1) for k in range(len(sections)-1) for i in range(n-1)]
    faces += [tuple(range(n)), tuple(range((len(sections)-1)*n, len(sections)*n))]
    obj = mesh(name, verts, faces, mat, group, True)
    obj.data.set_sharp_from_angle(angle=math.radians(sharp))
    return obj

root=bpy.data.objects.new("BlackJeep",None)
bpy.context.collection.objects.link(root)
root["wheel_radius_m"]=.47
root["wheelbase_m"]=2.76
root["mass_kg"]=2100
root["description"]="Lifted black Jeep, 37-inch mud tyres, four-wheel drive"
root["plate_text"]="@cosier"

# Ladder frame, skid plates, live-axle housings and visible four-link hardware.
for x in (-.54,.54): cube("Box-section frame rail",(x,0,.76),(.12,3.95,.18),satin,.025)
for y in (-1.6,-.65,.55,1.65): cube("Frame crossmember",(0,y,.76),(1.2,.12,.13),satin,.02)
cube("Underbody skid plate",(0,-.15,.715),(1.25,1.6,.065),alloy,.02)
for axle in (-1.38,1.38):
    cylinder("Axle tube",(0,axle,.47),.068,1.97,steel)
    cylinder("Differential housing",(.11,axle,.47),.18,.29,satin)
    for side in (-1,1):
        x=side*.65
        line("Lower control arm",[(x,axle,.43),(x,axle*.25,.79)],.04,satin)
        line("Upper control arm",[(side*.35,axle,.54),(side*.38,axle*.35,.87)],.028,steel)
        coil=[(x+.086*math.cos(i*math.tau/16),axle+.086*math.sin(i*math.tau/16),.55+i/96*.49) for i in range(97)]
        line("Articulated coil spring",coil,.015,spring)
        line("Damper body",[(side*.77,axle-.13,.55),(side*.69,axle-.16,.86)],.028,alloy)
        line("Polished shock shaft",[(side*.69,axle-.16,.86),(side*.65,axle-.18,1.06)],.011,bolt)
line("Driveshaft",[(.11,-1.38,.47),(0,-.15,.76),(.11,1.38,.47)],.043,steel)
cube("Cabin floor",(0,.37,.91),(1.7,3.23,.13),satin,.025)

# Continuous body sides with real open wheel arches, rather than a box over tyres.
ys=sorted({round(-2.04+i*4.16/144,6) for i in range(145)} | {round(a+d,6) for a in (-1.38,1.38) for d in (-.61,0,.61)})
for side in (-1,1):
    verts=[]
    for y in ys:
        low=.86
        for axle in (-1.38,1.38):
            if abs(y-axle)<.61: low=max(low,.47+math.sqrt(.61**2-(y-axle)**2))
        verts += [(side*.9,y,low),(side*.9,y,1.48),(side*.82,y,1.51)]
    faces=[]
    for i in range(len(ys)-1):
        for j in range(2): faces.append((i*3+j,(i+1)*3+j,(i+1)*3+j+1,i*3+j+1))
    mesh("Sculpted side with open arches",verts,faces,black)
    for axle in (-1.38,1.38):
        v,f=[],[]
        section=((.89,.57),(.905,.625),(.97,.662),(1.09,.672),(1.165,.657),(1.203,.627),(1.21,.60),(1.19,.583),(1.05,.585))
        m=len(section)
        for i in range(53):
            a=math.radians(-8)+(math.pi+math.radians(16))*i/52
            for x,r in section:
                v.append((side*x,axle+math.cos(a)*r,.47+math.sin(a)*r))
        for i in range(52):
            for j in range(m): f.append((i*m+j,(i+1)*m+j,(i+1)*m+(j+1)%m,i*m+(j+1)%m))
        flare=mesh("Wide bolt-on fender flare",v,f,trim,smooth=True)
        flare.data.set_sharp_from_angle(angle=math.radians(35))
        for i in range(7):
            a=(i+.5)*math.pi/7
            cylinder("Fender mounting bolt",(side*1.212,axle+math.cos(a)*.612,.47+math.sin(a)*.612),.011,.014,bolt,segments=10)
    line("Rock slider",[(side*1.0,-.68,.8),(side*1.07,-.5,.79),(side*1.07,.67,.79),(side*1.0,.82,.8)],.055,satin)
    cube("Door skin",(side*.908,-.03,1.2),(.042,1.25,.51),black,.025)
    for y in (-.55,.49):
        cube("Exposed door hinge",(side*.94,y,1.26),(.045,.065,.13),satin,.008)
    cube("Door handle",(side*.959,.39,1.46),(.04,.19,.043),satin,.015)
    # Shut lines round the door, so it reads as a panel that opens (the body was one smooth box).
    line("Door shut line",[(side*.932,-.655,.95),(side*.932,-.655,1.45),(side*.932,.595,1.45),(side*.932,.595,.95)],.004,trim)
    line("Mirror arm",[(side*.9,-.65,1.53),(side*1.12,-.66,1.69)],.024,satin)
    cube("Mirror shell",(side*1.15,-.65,1.74),(.11,.20,.19),satin,.035)
    cube("Mirror glass",(side*1.15,-.544,1.74),(.085,.008,.14),bolt,.014)

half=((.875,-.115),(.878,-.06),(.872,-.03),(.86,-.012),(.835,-.002),(.79,.004),(.60,.008),(.40,.010),(.345,.012),(.33,.026),(.31,.034),(.15,.040))
row=[(-x,dz) for x,dz in half]+[(0.0,.042)]+[(x,dz) for x,dz in reversed(half)]
sections=[]
for y,drop,narrow in [(-.82,0,1),(-.95,0,1),(-1.15,0,1),(-1.4,0,1),(-1.65,0,1),(-1.85,0,1),(-2.0,0,1),(-2.06,0,1),(-2.085,.012,.99),(-2.10,.04,.975)]:
    t=1.522-.010*(-.82-y)/1.24-drop
    taper=narrow*(1-.015*(-.82-y)/1.28)
    sections.append([(x*taper,y,t+(dz if drop<.03 else dz*.6)) for x,dz in row])
loft("Lofted bonnet",sections,black)
for side in (-1,1):
    for y in (-1.86,-.98): cube("Bonnet latch",(side*.87,y,1.43),(.048,.075,.14),trim,.009)
    # Recessed bonnet vents on the wings, slats inset in a black bezel.
    cube("Bonnet vent bezel",(side*.58,-1.22,1.525),(.30,.34,.012),trim,.006)
    for k in range(6): cube("Bonnet vent slat",(side*.58,-1.36+k*.056,1.531),(.27,.016,.006),satin,0)
cube("Cowl vent grille",(0,-.87,1.528),(1.42,.07,.014),trim,.005)
cube("Front grille surround",(0,-2.075,1.22),(1.76,.12,.58),black,.05)
cube("Recessed grille opening",(0,-2.144,1.225),(.88,.018,.43),trim,.035)
for k in range(11): cube("Recessed grille mesh",((k-5)*.078,-2.152,1.225),(.008,.008,.40),satin,.002)
for k in range(5): cube("Grille bar",(0,-2.160,1.065+k*.08),(.82,.016,.028),satin,.007)
cube("Grille centre post",(0,-2.163,1.225),(.05,.018,.42),satin,.01)
for side in (-1,1):
    c=(side*.657,-2.151,1.26)
    lathe("Headlamp bucket",c,((.196,-.012),(.196,-.036),(.178,-.040),(.170,-.022)),satin,segments=48)
    lathe("Headlamp reflector bowl",c,((.170,-.022),(.150,-.004),(.110,.026),(.060,.046),(.030,.050)),chrome,segments=48)
    lathe("Headlamp lens",c,((.172,-.040),(.150,-.048),(.100,-.056),(0,-.060)),lens,segments=48)
    ring("Thin running lamp ring",(c[0],c[1]-.030,c[2]),.158,.0045,lamp,"Y",segments=48)
    cylinder("Projector shroud",(c[0],c[1]+.012,c[2]),.052,.07,chrome,"Y",segments=24)
    cylinder("Projector lens",(c[0],c[1]-.024,c[2]),.040,.012,glass,"Y",segments=24)
    cube("Amber marker",(side*.91,-1.94,1.2),(.075,.14,.055),amber,.018)
# Steel bumper: a centre beam, wings swept back 22 degrees for approach angle, an angled bash plate
# under it and recovery tabs that carry the shackles (the old one was a single rounded box).
cube("Steel front bumper",(0,-2.21,.88),(1.30,.30,.22),satin,.02)
for side in (-1,1):
    wing=cube("Steel front bumper wing",(side*.84,-2.14,.89),(.44,.24,.19),satin,.02)
    wing.rotation_euler.z=side*math.radians(22)
    cube("Recovery tab",(side*.66,-2.37,.87),(.03,.13,.13),satin,.006)
plate_bash=cube("Front bash plate",(0,-2.13,.73),(1.12,.30,.025),satin,.006)
plate_bash.rotation_euler.x=math.radians(-24)
cube("Winch motor",(.13,-2.21,1.085),(.52,.24,.19),satin,.045)
cylinder("Winch drum",(-.12,-2.24,1.09),.077,.35,steel)
for i in range(16): ring("Winch cable winding",(-.275+i*.018,-2.24,1.09),.08,.007,alloy,segments=24)
cube("Winch fairlead",(0,-2.39,1.0),(.44,.07,.1),bolt,.035)
line("Stinger hoop",[(-.46,-2.34,1.0),(-.4,-2.40,1.38),(0,-2.43,1.47),(.4,-2.40,1.38),(.46,-2.34,1.0)],.042,satin)
for x in (-.66,.66): ring("Recovery shackle",(x,-2.397,.85),.066,.018,red,"Y",segments=24)

# Open cabin with fitted glass, angular pillars and removable black hardtop.
for side in (-1,1):
    line("A pillar",[(side*.855,-.79,1.50),(side*.80,-.48,2.08)],.037,black)
    line("B pillar",[(side*.89,.68,1.46),(side*.82,.68,2.12)],.045,satin)
    line("Rear pillar",[(side*.89,2.02,1.43),(side*.82,1.94,2.1)],.05,black)
    line("Upper door frame",[(side*.8,-.48,2.08),(side*.825,.68,2.12)],.025,black)
    mesh("Door glass",[(side*.877,-.72,1.54),(side*.808,-.46,2.047),(side*.80,.63,2.07),(side*.888,.63,1.54)],[(0,1,2,3)],glass,"GlassPanels")
    mesh("Rear quarter glass",[(side*.89,.77,1.54),(side*.82,.77,2.075),(side*.82,1.87,2.065),(side*.89,1.94,1.54)],[(0,1,2,3)],glass,"GlassPanels")
mesh("Windshield",[(-.837,-.773,1.55),(.837,-.773,1.55),(.775,-.472,2.044),(-.775,-.472,2.044)],[(0,1,2,3)],glass,"GlassPanels")
line("Windshield top frame",[(-.81,-.49,2.08),(.81,-.49,2.08)],.035,black)
line("Windshield bottom frame",[(-.855,-.80,1.525),(.855,-.80,1.525)],.035,black)
for x in (-.42,.32): line("Windshield wiper",[(x,-.791,1.57),(x+.21,-.69,1.74)],.009,satin)
cube("Hardtop",(0,.74,2.13),(1.73,2.58,.13),trim,.065)
cube("Tailgate",(0,2.09,1.17),(1.79,.14,.57),black,.035)
mesh("Rear window",[(-.82,2.049,1.53),(.82,2.049,1.53),(.78,1.971,2.06),(-.78,1.971,2.06)],[(0,1,2,3)],glass,"GlassPanels")
# Rear bumper: a centre beam with corners wrapped 24 degrees round the body, recovery tabs with
# shackles on the corners and a square hitch receiver (was one rounded box).
cube("Rear bumper",(0,2.21,.80),(1.36,.24,.20),satin,.02)
for side in (-1,1):
    wrap=cube("Rear bumper corner",(side*.84,2.15,.80),(.40,.22,.19),satin,.02)
    wrap.rotation_euler.z=-side*math.radians(24)
    cube("Rear recovery tab",(side*.86,2.20,.925),(.03,.12,.07),satin,.006)
    ring("Rear recovery shackle",(side*.86,2.20,.97),.05,.015,red,"X",segments=24)
cube("Hitch receiver",(0,2.36,.74),(.075,.16,.075),satin,.008)
cube("Hitch receiver mouth",(0,2.441,.74),(.05,.004,.05),trim,0)
for side in (-1,1):
    cube("Rear lamp housing",(side*.76,2.176,1.25),(.23,.10,.27),satin,.03)
    cube("Rear red lamp",(side*.76,2.235,1.27),(.16,.016,.16),tail,.025)
    for k in range(3): cube("Rear lamp divider",(side*.76,2.245,1.215+k*.04),(.15,.006,.006),satin,0)
    for dx,dz,sx,sz in ((0,.085,.17,.008),(0,-.085,.17,.008),(.085,0,.008,.17),(-.085,0,.008,.17)):
        cube("Rear lamp chrome bezel",(side*.76+dx,2.243,1.27+dz),(sx,.008,sz),chrome,0)
    cube("Reverse lamp",(side*.76,2.236,1.17),(.14,.015,.038),lamp,.008)
cube("Rear licence plate",(-.60,2.345,.79),(.31,.017,.105),plate,.008)
lettering("Rear @cosier plate","@cosier",(-.60,2.36,.79),.053,trim)
cube("Front licence plate",(0,-2.385,.79),(.44,.017,.13),plate,.008)
lettering("Front @cosier plate","@cosier",(0,-2.40,.79),.078,trim,rotation=(math.pi/2,0,0))

# Cabin details are visible through glass, not a solid body filling the windows.
cube("Dashboard",(0,-.57,1.40),(1.57,.28,.22),interior,.06,"InteriorAssembly")
for x in (-.45,.45):
    cube("Seat cushion",(x,.13,1.04),(.54,.55,.18),seat,.065,"InteriorAssembly")
    back=cube("Front seat back",(x,.39,1.38),(.54,.18,.63),seat,.07,"InteriorAssembly"); back.rotation_euler.x=.10
    cube("Head restraint",(x,.39,1.77),(.32,.16,.23),interior,.065,"InteriorAssembly")
cube("Rear bench",(0,1.32,1.03),(1.4,.55,.22),seat,.06,"InteriorAssembly")
cube("Rear backrest",(0,1.61,1.40),(1.4,.19,.66),seat,.055,"InteriorAssembly")
ring("Steering wheel",(-.44,-.33,1.48),.185,.02,satin,"Y","InteriorAssembly",48)
line("Steering column",[(-.44,-.48,1.39),(-.44,-.33,1.48)],.029,satin,"InteriorAssembly")
line("Gear lever",[(.13,-.03,1.02),(.13,-.06,1.26)],.015,steel,"InteriorAssembly")
cube("Gear knob",(.13,-.06,1.27),(.055,.055,.075),satin,.025,"InteriorAssembly")
# Sports bar behind the front seats, seen through the glass: main hoop, harness bar and two tubes
# back along the roof sides to the rear corners (game choice after common aftermarket cages).
line("Sports bar hoop",[(-.74,.62,.98),(-.74,.62,1.90),(-.62,.62,2.02),(.62,.62,2.02),(.74,.62,1.90),(.74,.62,.98)],.032,satin,"InteriorAssembly")
line("Sports bar harness bar",[(-.74,.62,1.52),(.74,.62,1.52)],.024,satin,"InteriorAssembly")
for x in (-.70,.70): line("Sports bar rear tube",[(x,.62,2.0),(x,1.80,1.96),(x,1.86,.98)],.028,satin,"InteriorAssembly")

# Roof rack, LED light bar, snorkel and compact expedition hardware.
for x in (-.69,.69):
    line("Roof rack side rail",[(x,-.44,2.3),(x,1.84,2.3)],.025,satin)
    for y in (-.32,.68,1.64): cube("Roof rack foot",(x,y,2.22),(.07,.14,.17),satin,.014)
for y in [-.4+i*.25 for i in range(10)]: line("Roof rack slat",[(-.7,y,2.265),(.7,y,2.265)],.018,satin)
for y in (-.45,1.87): line("Roof rack end rail",[(-.69,y,2.3),(.69,y,2.3)],.025,satin)
cube("Roof light bar housing",(0,-.60,2.205),(1.25,.105,.095),satin,.025)
for i in range(14): cube("LED light bar optic",(-.56+i*.086,-.659,2.205),(.056,.012,.044),lamp,.01)
line("Snorkel riser",[(.98,-1.32,1.36),(.97,-.86,1.47),(.92,-.55,2.10)],.058,trim)
cube("Snorkel intake",(.94,-.48,2.12),(.15,.22,.13),trim,.035)
for z in (2.10,2.135): cube("Intake grille slot",(.94,-.362,z),(.10,.008,.012),satin,.003)

# 37-inch mud tyres: raised alternating lugs, deep channels, beadlock hardware.
wheel_pivots=[]
def make_wheel(name, side, location, spare=False):
    pivot=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(pivot)
    pivot.location=location; pivot.parent=root
    if spare: pivot.rotation_euler.z=math.pi/2
    else: wheel_pivots.append(pivot)
    profile=[(-.185,.238),(-.198,.30),(-.19,.40),(-.15,.446),(-.10,.455),(.10,.455),(.15,.446),(.19,.40),(.198,.30),(.185,.238)]
    v,f=[],[]; n=64; w=len(profile)
    for i in range(n):
        a=math.tau*i/n
        v.extend((x,r*math.sin(a),r*math.cos(a)) for x,r in profile)
    for i in range(n):
        for j in range(w): f.append((i*w+j,((i+1)%n)*w+j,((i+1)%n)*w+(j+1)%w,i*w+(j+1)%w))
    mesh("Large rounded mud tyre",v,f,rubber,name,True)
    for i in range(32):
        for lane in (-1,0,1):
            a=math.tau*(i+(.38 if lane==0 else 0))/32
            obj=cube("Deep staggered tread lug",(lane*.112,.456*math.sin(a),.456*math.cos(a)),(.104,.072,.028),lugmat,0,name)
            obj.rotation_euler.x=-a
            obj.rotation_euler.z=lane*.16
    outer=side*.199
    cylinder("Black wheel barrel",(0,0,0),.243,.31,alloy,group=name)
    ring("Beadlock ring",(outer,0,0),.246,.016,alloy,group=name)
    cylinder("Hub centre",(side*.209,0,0),.066,.032,satin,group=name)
    for i in range(8):
        a=math.tau*i/8
        spoke=cube("Eight-spoke wheel",(side*.208,.137*math.sin(a),.137*math.cos(a)),(.027,.034,.166),alloy,.008,name)
        spoke.rotation_euler.x=-a
    for i in range(24):
        a=math.tau*i/24
        cylinder("Beadlock bolt",(side*.218,.248*math.sin(a),.248*math.cos(a)),.009,.014,bolt,group=name,segments=8)
    for i in range(5):
        a=math.tau*i/5
        cylinder("Lug nut",(side*.23,.05*math.sin(a),.05*math.cos(a)),.009,.012,bolt,group=name,segments=8)
    for face in (-1,1):
        ring("Sidewall bead",(face*.195,0,0),.32,.003,lugmat,group=name,segments=64)
        for i in range(24):
            a=math.tau*i/24
            obj=cube("Sidewall protection rib",(face*.196,.368*math.sin(a),.368*math.cos(a)),(.009,.024,.064),lugmat,0,name)
            obj.rotation_euler.x=-a
    geom=join_group(name+"Geometry",groups.pop(name),pivot)
    geom.location=(0,0,0)

for name,side,axle in (("WheelFrontL",-1,-1.38),("WheelFrontR",1,-1.38),("WheelRearL",-1,1.38),("WheelRearR",1,1.38)):
    make_wheel(name,side,(side*1.02,axle,.47))
# The spare stands 4 cm clear of the tailgate on a carrier (it sat 11 cm inside it), above the bumper.
make_wheel("RearSpare",1,(.0,2.405,1.40),True)
cube("Spare wheel carrier plate",(0,2.185,1.40),(.30,.05,.30),satin,.01)
cylinder("Spare wheel carrier hub",(0,2.27,1.40),.07,.18,steel,"Y",segments=24)
for name,objects in list(groups.items()):
    if objects: join_group(name,objects,root)

bpy.ops.object.select_all(action="DESELECT")
asset=[root]+list(root.children_recursive)
for obj in asset: obj.select_set(True)
bpy.context.view_layer.objects.active=root
glb=GAME/"black_jeep.glb"
bpy.ops.export_scene.gltf(filepath=str(glb),export_format="GLB",use_selection=True,export_apply=True,export_yup=True,export_extras=True,export_cameras=False,export_lights=False)
binary=glb.read_bytes(); doc=json.loads(binary[20:20+struct.unpack_from('<I',binary,12)[0]])
for name,_,_ in (("WheelFrontL",-1,-1.38),("WheelFrontR",1,-1.38),("WheelRearL",-1,1.38),("WheelRearR",1,1.38)):
    node=next(n for n in doc['nodes'] if n.get('name')==name)
    assert abs(node['translation'][1]-.47)<1e-5
    assert node.get('rotation',[0,0,0,1])==[0,0,0,1]
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in asset if o.type=='MESH')
assert triangles<160_000,triangles
report={"generator":"tools/rally/build_black_jeep.py","blender":bpy.app.version_string,"triangles":triangles,"glb_bytes":len(binary),"wheel_radius_m":.47,"wheelbase_m":2.76,"track_width_m":2.04,"tyre_width_m":.396,"wheel_pivots":[p.name for p in wheel_pivots]}
(OUT/'black_jeep_report.json').write_text(json.dumps(report,indent=2)+'\n')

# Editable asset with a repeatable studio; studio is deliberately outside export.
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.device='CPU'; scene.cycles.samples=40
scene.cycles.use_denoising=True
scene.render.resolution_x=1600; scene.render.resolution_y=1100; scene.render.resolution_percentage=100
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.16,.20,.24,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.45
scene.view_settings.view_transform='AgX'
floor=material('StudioFloor',(.12,.14,.16),.05,.6)
cube('Studio floor',(0,0,-.056),(200,200,.1),floor,0,None)
def area(name,loc,power,size,color):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='DISK'; data.size=size; data.color=color
    obj=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(obj); obj.location=loc
    obj.rotation_euler=(Vector((0,0,1))-obj.location).to_track_quat('-Z','Y').to_euler()
area('Broad warm key',(2,-4,7),1800,5,(1,.9,.77))
area('Cool side softbox',(-4,-1,4),1500,4,(.7,.84,1))
area('Roof and rear rim',(2,4,6),2400,4,(1,.94,.85))
area('Grille fill',(0,-6,2),650,3,(.88,.94,1))
camera_data=bpy.data.cameras.new('Studio camera'); camera=bpy.data.objects.new('Studio camera',camera_data)
bpy.context.collection.objects.link(camera); scene.camera=camera; camera_data.lens=52
def set_camera(loc):
    camera.location=loc; camera.rotation_euler=(Vector((0,0,1.1))-camera.location).to_track_quat('-Z','Y').to_euler()
set_camera((6,-8,3.7))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'black_jeep.blend'))
if '--no-render' not in sys.argv:
    for name,loc in [('black_jeep_front.png',(6,-8,3.7)),('black_jeep_rear.png',(-6,8,3.5))]:
        set_camera(loc); scene.render.filepath=str(PREVIEW/name); bpy.ops.render.render(write_still=True)
print('BLACK_JEEP_ASSET',json.dumps(report))
