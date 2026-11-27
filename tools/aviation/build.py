"""Reproducible Tidewater aviation assets. Blender 5.0+, no external downloads.
Run: blender -b --python tools/aviation/build.py -- --root .
Author coordinates are GAME: +Y up, +Z nose, metres. Vertex conversion (x,-z,y)
then glTF Y-up export gives game coordinates identically. Named pivots survive.
Repeated hardware is batched per material and pivot, not thousands of draw calls.
"""
import subprocess
import bpy, bmesh, math, json, argparse, os, random, sys
from pathlib import Path
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--root',default='.');p.add_argument('--no-render',action='store_true');p.add_argument('--asset',choices=['all','carrier','fighter'],default='all');args=p.parse_args(args)
ROOT=Path(args.root).resolve();PUB=ROOT/'public/aviation';ASSETS=ROOT/'assets/aviation';PUB.mkdir(parents=True,exist_ok=True);ASSETS.mkdir(parents=True,exist_ok=True)
BATCH={};PIVOTS={};MATS={};OBJECTS=[]
def cv(v):return (v[0],-v[2],v[1])
def mat(name,color,metal=0,rough=.55,alpha=1,emission=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,alpha);m.use_nodes=True;n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(*color,alpha);n.inputs['Metallic'].default_value=metal;n.inputs['Roughness'].default_value=rough;n.inputs['Alpha'].default_value=alpha
 if emission:n.inputs['Emission Color'].default_value=(*color,1);n.inputs['Emission Strength'].default_value=emission
 if alpha<1:m.surface_render_method='BLENDED';m.use_transparency_overlap=False
 MATS[name]=m;return name
def mesh(name,v,f,m,group='Static'):
 # Tiny hinge and service details reuse their assembly finish to bound draw calls.
 if group.startswith('Aileron'):m='AircraftGrey'
 elif group.startswith('Flap'):m='HullPanelGrey'
 elif group.startswith('Gear') and m=='Black':m='Rubber'
 elif group.startswith('Gear') and m=='SafetyYellow':m='SteelGrey'
 key=(group,m);vv,ff=BATCH.setdefault(key,([],[]));offset=len(vv);vv.extend(v);ff.extend(tuple(offset+i for i in face) for face in f)
def prism(name,outline,y0,y1,m,group='Static'):
 n=len(outline);v=[(x,y,z) for y in [y0,y1] for x,z in outline];f=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)];mesh(name,v,f,m,group)
def paint_line(name,a,b,width,m):
 dx,dz=b[0]-a[0],b[2]-a[2];length=math.hypot(dx,dz);nx,nz=dz/length*width/2,-dx/length*width/2
 prism(name,[(a[0]+nx,a[2]+nz),(a[0]-nx,a[2]-nz),(b[0]-nx,b[2]-nz),(b[0]+nx,b[2]+nz)],18.031,18.035,m)
def box(name,c,s,m,group='Static',yaw=0):
 x,y,z=c;a,b,d=[i/2 for i in s];co,si=math.cos(yaw),math.sin(yaw);o=[(-a,-d),(a,-d),(a,d),(-a,d)];o=[(x+xx*co+zz*si,z-xx*si+zz*co)for xx,zz in o];prism(name,o,y-b,y+b,m,group)
def rod(name,a,b,r,m,group='Static',n=8):
 a,b=Vector(a),Vector(b);axis=(b-a).normalized();t=axis.cross(Vector((0,1,0)))
 if t.length<.01:t=axis.cross(Vector((1,0,0)))
 t.normalize();u=axis.cross(t);v=[]
 for pt in [a,b]:
  for i in range(n):v.append(tuple(pt+r*(t*math.cos(math.tau*i/n)+u*math.sin(math.tau*i/n))))
 f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)];mesh(name,v,f,m,group)
def ring(name,c,r,t,m,normal=(0,1,0),group='Static',n=14,k=5):
 c=Vector(c);axis=Vector(normal).normalized();u=axis.cross(Vector((1,0,0)))
 if u.length<.01:u=axis.cross(Vector((0,1,0)))
 u.normalize();v=axis.cross(u);verts=[]
 for i in range(n):
  radial=u*math.cos(math.tau*i/n)+v*math.sin(math.tau*i/n)
  for j in range(k):verts.append(tuple(c+radial*(r+t*math.cos(math.tau*j/k))+axis*(t*math.sin(math.tau*j/k))))
 faces=[(i*k+j,((i+1)%n)*k+j,((i+1)%n)*k+(j+1)%k,i*k+(j+1)%k)for i in range(n)for j in range(k)];mesh(name,verts,faces,m,group)
def ellipsoid(name,c,r,m,group='Static',n=24,k=12):
 v=[]
 for j in range(k+1):
  a=-math.pi/2+math.pi*j/k
  for i in range(n):
   b=math.tau*i/n;v.append((c[0]+r[0]*math.cos(a)*math.cos(b),c[1]+r[1]*math.sin(a),c[2]+r[2]*math.cos(a)*math.sin(b)))
 f=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)for j in range(k)for i in range(n)];mesh(name,v,f,m,group)
def loft(name,stations,m,group='Static',n=32):
 # Stations: z, half width, half height, vertical centre.
 v=[]
 for z,w,h,y in stations:
  for i in range(n):
   a=math.tau*i/n;v.append((w*math.cos(a),y+h*math.sin(a),z))
 f=[tuple(reversed(range(n))),tuple(range((len(stations)-1)*n,len(stations)*n))]
 f += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)for j in range(len(stations)-1)for i in range(n)];mesh(name,v,f,m,group)
def pivot(name,point):PIVOTS[name]=point

def paint():
 mat('HullGrey',(.34,.39,.41),.25,.65);mat('HullPanelGrey',(.30,.35,.37),.22,.72);mat('BootTop',(.028,.033,.035),.1,.75);mat('Antifouling',(.22,.062,.047),.0,.85)
 mat('DeckNonslip',(.075,.095,.11),.1,.93);mat('SteelGrey',(.43,.49,.51),.55,.43);mat('SteelDark',(.13,.17,.18),.75,.4);mat('BrightMetal',(.58,.64,.66),.92,.28)
 mat('WhiteMarking',(.78,.81,.78),0,.8);mat('SafetyYellow',(.9,.60,.08),.05,.6);mat('SafetyRed',(.63,.052,.025),.12,.6);mat('Glass',(.025,.14,.19),.5,.17)
 mat('Black',(.015,.021,.023),.1,.7);mat('Rubber',(.019,.023,.026),0,.9);mat('Orange',(.94,.25,.035),0,.5);mat('AircraftGrey',(.38,.46,.49),.35,.46);mat('AircraftLight',(.5,.58,.60),.3,.5)
 mat('Canopy',(.11,.32,.38),.65,.11,.48);mat('GreenLight',(.12,.9,.4),0,.4,1,3);mat('RedLight',(1,.075,.035),0,.4,1,3);mat('WarmLight',(.94,.8,.47),0,.4,1,2)

def text_mesh(content,point,size,m,rotation=(math.pi/2,0,0),group='Static',extrude=.001):
 # Use Blender text only as a modelling tool; converted geometry is batched.
 data=bpy.data.curves.new('Deck lettering','FONT');data.body=content;data.align_x='CENTER';data.size=size;data.extrude=extrude
 obj=bpy.data.objects.new(content,data);bpy.context.collection.objects.link(obj);obj.location=cv(point);obj.rotation_euler=rotation;bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.convert(target='MESH');bpy.context.view_layer.update()
 verts=[]
 for v in obj.data.vertices:
  q=obj.matrix_world@v.co;verts.append((q.x,q.z,-q.y))
 mesh(content,verts,[tuple(f.vertices)for f in obj.data.polygons],m,group);bpy.data.objects.remove(obj,do_unlink=True)

def carrier():
 # Lofted hull: fine bow, broad stern, rounded bilges and flared upper shell.
 stations=[(-158,12),(-148,17),(-125,19),(-90,20),(-40,20),(20,20),(65,19.5),(100,17),(125,12),(145,6),(158,.6)]
 section=[(-.92,16),(-1,7),(-.96,0),(-.9,-5),(-.68,-9),(-.33,-10.8),(0,-11),(.33,-10.8),(.68,-9),(.9,-5),(.96,0),(1,7),(.92,16)]
 for ylow,yhigh,material in [(-11,-.2,'Antifouling'),(-.2,.8,'BootTop'),(.8,16,'HullGrey')]:
  # Separate waterline material bands preserve genuine hull shape.
  ringv=[]
  for z,w in stations:
   points=[(x,y)for x,y in section if ylow<=y<=yhigh]
   def width(y):
    tab=[(-11,.04),(-10.8,.33),(-9,.68),(-5,.9),(0,.96),(7,1),(16,.92)]
    for i in range(len(tab)-1):
     if tab[i][0]<=y<=tab[i+1][0]:return tab[i][1]+(tab[i+1][1]-tab[i][1])*(y-tab[i][0])/(tab[i+1][0]-tab[i][0])
    return .92
   ys=sorted(set([ylow,yhigh]+[v for v in [-10.8,-9,-5,0,7]if ylow<v<yhigh]));points=[(-width(y),y)for y in reversed(ys)]+[(width(y),y)for y in ys]
   ringv.append([(x*w,y,z)for x,y in points])
  n=len(ringv[0]);verts=sum(ringv,[]);faces=[tuple(reversed(range(n))),tuple(range((len(ringv)-1)*n,len(ringv)*n))]+[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)for j in range(len(ringv)-1)for i in range(n)]
  mesh('Hydrodynamic hull',verts,faces,material)
 outline=[(-27,-160),(27,-160),(36,-135),(36,68),(28,145),(18,160),(-18,160),(-34,110),(-42,35),(-42,-70),(-35,-145)]
 prism('Flight deck structural edge',outline,16,18,'HullGrey');prism('Flight deck',outline,18,18.025,'DeckNonslip')
 # Island: terraced and chamfered on the starboard edge.
 def island_tier(y0,y1,x0,x1,z0,z1,m):prism('Faceted island',[(x0+1,z0),(x1-1,z0),(x1,z0+2),(x1,z1-2),(x1-2,z1),(x0,z1),(x0,z0+2)],y0,y1,m)
 island_tier(18,25,20,34,-27,27,'HullGrey');island_tier(25,31,20.7,34,-22,25,'HullPanelGrey');island_tier(31,36,21.3,34,-16,23,'HullGrey');island_tier(36,40,19.7,35,-8,21,'HullPanelGrey')
 island_tier(40,43,21.3,34,-5,17,'HullGrey');island_tier(43,45,22,33,-1,13,'HullGrey')
 for y,z0,z1,x0,x1 in [(29,-20,24,20.5,34.1),(38,-6,20,19.6,35.1),(41.5,-4,16,21.2,34.1)]:
  for z in range(int(z0),int(z1),3):
   for x in [x0,x1]:box('Bridge window',(x,y,z+1),(0.08,1.25,2.2),'Glass')
  for x in range(int(x0+1),int(x1),2):box('Bridge forward window',(x,y,z1),(1.4,1.25,.1),'Glass')
 for z in [-18,-9,0,9,18]:
  box('Island access door',(19.98,21,z),(.08,2.1,1.0),'SteelDark');rod('Door handle',(19.86,21,z-.2),(19.86,21,z+.15),.035,'BrightMetal')
 # Intake/exhaust trunks, gantry mast, scanned array radar and antenna farms.
 box('Exhaust trunk',(29,39,-17),(6,16,9),'HullPanelGrey');box('Stack cap',(29,47.2,-17),(6.6,1,9.6),'Black')
 for z in [-19,-16,-13]:box('Stack louvres',(25.95,42,z),(.12,7,1.1),'SteelDark')
 for x in [24,31]:rod('Mast leg',(x,43,5),(27.5,59,6),.34,'SteelGrey',n=10)
 rod('Mast platform',(21,51,6),(34,51,6),.3,'SteelGrey');box('Radar platform',(27.5,52,6),(13,1,8),'HullGrey')
 pivot('CarrierRadar',(27.5,56,6));box('Radar back',(27.5,56,6),(10,4.5,1.4),'SteelDark','CarrierRadar')
 for ix in range(12):
  for iy in range(5):box('Radar tile',(22.5+ix*.87,54.2+iy*.85,6.78),(.77,.72,.12),'SteelGrey','CarrierRadar')
 for x,z,h in [(24,1,16),(31,1,13),(23,10,12),(32,11,18),(28,-1,20)]:rod('Antenna',(x,45,z),(x,45+h,z),.08,'SteelGrey');rod('Antenna brace',(x-1,46,z),(x,51,z),.04,'SteelGrey')
 for x,z in [(22,14),(32,-9)]:ellipsoid('Comms radome',(x,47,z),(1.8,2,1.8),'WhiteMarking')
 # Catapult tracks, shuttle pockets and raised blast deflectors.
 for x in [8,21]:
  for dx in [-.5,.5]:box('Catapult rail',(x+dx,18.075,76),(.12,.1,106),'BrightMetal')
  box('Catapult slot',(x,18.05,76),(.55,.03,106),'Black');box('Catapult shuttle',(x,18.14,24),(1.0,.15,1.8),'SteelGrey')
  for k in range(6):
   z=14-k*.65;box('Blast deflector segment',(x,18.3+k*.44,z),(9,.24,.8),'SteelDark')
   rod('Deflector ram',(x-3.6,18,10),(x-3.6,20.2,11.5),.15,'BrightMetal')
  for side in [-1,1]:box('Launch stripe',(x+side*4.8,18.04,77),(.24,.025,108),'WhiteMarking')
 # Angled recovery runway, clear landing area, actual corresponding wires.
 heading=-math.radians(7);sx,cx=math.sin(heading),math.cos(heading)
 def runway(x,z,y=18.055):return (-9+x*cx+z*sx,y,-142-x*sx+z*cx)
 for side in [-1,1]:
  a=runway(side*12,0);b=runway(side*12,195);paint_line('Landing lane edge',a,b,.24,'WhiteMarking')
 for z in range(0,187,14):paint_line('Landing centre dash',runway(0,z),runway(0,z+6),.3,'WhiteMarking')
 for z in [30,42,54,66]:
  rod('Arresting cable',runway(-12.5,z,18.13),runway(12.5,z,18.13),.065,'BrightMetal',n=8)
  for side in [-1,1]:ellipsoid('Cable sheave',runway(side*13,z,18.16),(.35,.18,.4),'SteelDark',n=12,k=5)
 for x in [-8,-5,-2,2,5,8]:paint_line('Threshold piano keys',runway(x,3),runway(x,10),.8,'WhiteMarking')
 # Elevators with panel gaps and caution perimeter.
 for x,z,w,l in [(29,-80,13,25),(29,65,13,25),(-34,-95,14,23)]:
  box('Deck elevator',(x,18.05,z),(w,.10,l),'HullPanelGrey')
  for xx in [x-w/2,x+w/2]:box('Elevator seam',(xx,18.12,z),(.16,.06,l),'Black')
  for zz in [z-l/2,z+l/2]:box('Elevator caution',(x,18.12,zz),(w,.06,.22),'SafetyYellow')
 # Catwalks and repeated rails and safety nets follow deck outline.
 for i,(x,z) in enumerate(outline):
  xx,zz=outline[(i+1)%len(outline)];d=math.hypot(xx-x,zz-z);n=max(1,int(d/3));nx=(zz-z)/d;nz=-(xx-x)/d
  a=(x+nx*1.1,15.5,z+nz*1.1);b=(xx+nx*1.1,15.5,zz+nz*1.1);rod('Catwalk outer rail',a,b,.1,'SteelGrey');rod('Deck safety net frame',(x,17.3,z),(xx,17.3,zz),.09,'SteelGrey')
  for j in range(n):
   t=(j+.5)/n;px=x+(xx-x)*t;pz=z+(zz-z)*t
   rod('Catwalk support',(px,16,pz),(px+nx*1.8,14.8,pz+nz*1.8),.12,'SteelGrey')
   rod('Catwalk stanchion',(px+nx*1.1,14.5,pz+nz*1.1),(px+nx*1.1,16.5,pz+nz*1.1),.065,'SteelGrey')
   rod('Net rib',(px,17.3,pz),(px+nx*2.1,17.5,pz+nz*2.1),.035,'SteelGrey')
  for off in [.7,1.4,2.1]:rod('Net longitudinal',(x+nx*off,17.3+off*.09,z+nz*off),(xx+nx*off,17.3+off*.09,zz+nz*off),.025,'SteelGrey')
 # Tie-down crosses, deck weld panels, drain grilles and navigation lights.
 for x in range(-28,29,7):
  for z in range(-140,140,12):
   if x>17 and -35<z<33:continue
   ring('Tie-down eye',(x,18.07,z),.18,.035,'Black',n=10,k=4)
   rod('Tie-down bar',(x-.13,18.1,z),(x+.13,18.1,z),.025,'SteelGrey')
 for z in range(-135,130,15):
  for x in [-25,25]:
   box('Scupper grate',(x,18.04,z),(1.6,.05,.5),'SteelDark')
   for k in range(5):box('Scupper rib',(x-.7+k*.35,18.08,z),(.06,.04,.55),'SteelGrey')
 # Hull service galleries, doorways, boat cradles, rescue boats and life rafts.
 for side in [-1,1]:
  for z in range(-115,90,34):
   x=side*21
   box('Service gallery',(x,10,z),(5,1.2,20),'HullPanelGrey')
   for zz in [-6,0,6]:box('Gallery doorway',(side*20.1,12,z+zz),(.16,3.2,2),'SteelDark')
   ellipsoid('Rescue boat',(side*23,12,z),(2,1.5,5.6),'HullGrey',n=20,k=8);ellipsoid('Boat flotation',(side*23,13,z),(1.8,.7,4.7),'Orange',n=16,k=6)
   for off in [-4,4]:rod('Davit',(side*21,11,z+off),(side*26,16,z+off),.18,'SteelGrey');rod('Davit cable',(side*26,16,z+off),(side*24,13,z+off),.045,'SteelDark')
  for z in range(-130,130,18):
   for zz in [-2,2]:rod('Life raft canister',(side*23.5,15,z+zz-1.1),(side*23.5,15,z+zz+1.1),.55,'WhiteMarking',n=12)
 # Stern wake deck galleries and recessed mooring fixtures.
 for x in [-20,-12,12,20]:rod('Mooring bollard',(x,12,-157),(x,13.3,-157),.4,'SteelDark',n=12);rod('Mooring crossbar',(x-.8,13,-157),(x+.8,13,-157),.22,'SteelDark')
 for side in [-1,1]:
  for z in [-130,-70,0,80,130]:ellipsoid('Flight deck light',(side*31,18.3,z),(.18,.13,.25),'WarmLight',n=8,k=4)
 text_mesh('07',(0,18.08,137),9,'WhiteMarking',rotation=(0,0,0));text_mesh('TIDEWATER',(36.04,20,-12),1.4,'WhiteMarking',rotation=(math.pi/2,0,math.pi/2))


def airfoil(name,sign,stations,y,m,group='Static'):
 # Span stations (absolute x, leading z, trailing z), a symmetric thickness
 # distribution with a rounded leading edge and closed sharp trailing edge.
 n=18;v=[]
 for x,lead,trail in stations:
  chord=lead-trail
  for side in [1,-1]:
   for j in range(n+1):
    t=(1-math.cos(math.pi*j/n))/2
    thickness=5*.045*chord*(.2969*math.sqrt(t)-.126*t-.3516*t*t+.2843*t**3-.1036*t**4)
    v.append((sign*x,y+side*thickness,lead-t*chord))
 step=2*(n+1);f=[]
 for i in range(len(stations)-1):
  for side in range(2):
   for j in range(n):
    a=i*step+side*(n+1)+j;b=a+step;f.append((a,a+1,b+1,b)if side==0 else(a,b,b+1,a+1))
 for i in [0,len(stations)-1]:
  base=i*step;f.append(tuple([base+j for j in range(n+1)]+[base+n+1+j for j in reversed(range(n+1))]))
 mesh(name,v,f,m,group)

# Single-seat F/A-18E, NAVAIR's 60.3 ft by 44.9 ft reference, scaled to
# the game's 18.35 m by 13.68 m envelope. Stations and hardware are in metres.
def fighter_shell(name, sections, material, group='Static'):
 # A closed loft, including end caps. Each section has matching perimeter vertices.
 n=len(sections[0])
 faces=[tuple(reversed(range(n))),tuple(range((len(sections)-1)*n,len(sections)*n))]
 faces.extend((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
              for j in range(len(sections)-1) for i in range(n))
 mesh(name,[v for section in sections for v in section],faces,material,group)


def fighter():
 # Nose and cockpit chine flow aft into a broad, shallow twin-lobed engine deck.
 # The narrow centre tail ends between the open engine cans.
 mat('GhostGrey',(.32,.365,.405),.12,.54)
 mat('LightGhost',(.49,.53,.55),.08,.60)
 mat('Radome',(.26,.27,.275),.04,.65)
 mat('Titanium',(.20,.203,.197),.68,.46)
 mat('Graphite',(.060,.073,.084),.09,.63)
 mat('Stencil',(.14,.175,.19),.06,.66)
 canopy=MATS['Canopy']
 bs=canopy.node_tree.nodes.get('Principled BSDF')
 bs.inputs['Metallic'].default_value=.18
 bs.inputs['Alpha'].default_value=.28
 bs.inputs['Base Color'].default_value=(.16,.28,.29,1)
 canopy.diffuse_color=(.16,.28,.29,.28)
 stations=[(-8.40,.14,.09,.04),(-8.13,.38,.16,.06),(-7.80,1.12,.30,.04),
           (-7.46,1.40,.48,.04),(-6.65,1.54,.59,.06),(-5.35,1.69,.68,.09),
           (-3.70,1.81,.73,.10),(-2.28,1.83,.77,.09),(-1.0,1.67,.77,.10),
           (.65,1.30,.76,.12),(1.85,.86,.70,.14),(3.25,.76,.64,.17),
           (4.65,.70,.63,.16),(5.55,.65,.60,.13),(6.85,.55,.48,.10),
           (7.65,.455,.39,.07),(8.45,.33,.29,.032),(9.07,.19,.16,-.01),
           (9.53,.06,.052,-.04),(9.70,.007,.007,-.056)]
 def skin(st,a):
  z,w,h,y=st
  x=math.cos(a)
  s=math.sin(a)
  chine=max(0,min(1,(3-z)/3,(z+8.3)/.8))
  belly=math.copysign(abs(s)**(1-.40*chine),s)
  valley=1-chine*.31*math.exp(-(x/.28)**2)
  return (w*x,y+h*belly*valley,z)
 n=48
 # Retain shared normals along station boundaries within each paint finish.
 rings=[[skin(st,math.tau*i/n) for i in range(n)] for st in stations]
 faces_by_finish={}
 for j,st in enumerate(stations[:-1]):
  for i in range(n):
   finish='Radome' if st[0]>=6.85 else 'LightGhost' if i>=n//2 else 'GhostGrey'
   a=math.tau*(i+.5)/n
   if 4.65<=st[0]<6.85 and i<n//2 and abs(math.cos(a))<.52:
    finish='Graphite'
   k=(i+1)%n
   faces_by_finish.setdefault(finish,[]).append((j*n+i,j*n+k,(j+1)*n+k,(j+1)*n+i))
 vertices=sum(rings,[])
 for finish,faces in faces_by_finish.items():
  used=sorted({i for face in faces for i in face})
  index={old:new for new,old in enumerate(used)}
  mesh('Skin',[vertices[i] for i in used],[tuple(index[i] for i in face) for face in faces],finish)
 for st in [stations[0],stations[-1]]:
  mesh('End cap',[skin(st,math.tau*i/n) for i in range(n)],[tuple(range(n))],'Radome' if st[0]>0 else 'GhostGrey')
 # Fine recessed-panel boundaries follow each local cross section.
 for z in [6.85,5.72,-2.10,-4.72,-6.92]:
  for st,end in zip(stations,stations[1:]):
   if st[0]<=z<=end[0]:
    t=(z-st[0])/(end[0]-st[0])
    section=[u+(v-u)*t for u,v in zip(st,end)]
    points=[skin(section,math.tau*i/48) for i in range(49)]
    mesh('Panel joint',[(x*1.003,y+.002*math.sin(math.tau*i/48),zz+d) for d in [-.006,.006] for i,(x,y,zz) in enumerate(points)],[(i,i+1,50+i,49+i) for i in range(48)],'Stencil')
    break
 loft('Dorsal spine',[(-6.85,.025,.025,.42),(-5.4,.34,.16,.53),(-3.5,.44,.26,.60),
      (-1.3,.53,.35,.66),(.4,.56,.39,.72),(1.32,.55,.37,.83),(2.0,.48,.28,.90)],'GhostGrey')
 for side,letter in [(-1,'L'),(1,'R')]:
  # One continuous airfoil envelope from the canopy chine to the tip. The
  # inboard stations describe the ogee. The outer panel has a straight hinge.
  wing=[(.58,5.52,-3.24),(.74,5.22,-3.24),(.91,4.45,-3.24),(1.13,3.47,-3.24),
        (1.41,2.46,-3.24),(1.73,1.68,-3.24),(2.04,1.20,-3.24),(2.30,1.02,-3.24),
        (4.68,.02,-3.24),(6.71,-.96,-3.24)]
  sections=[]
  def half_depth(x,chord,t):
   # The long root-extension chord is a thin chine, widest over the intake shoulders.
   return (1-.55*max(0,min(1,(2.3-x)/1.6)))*(.042-.023*t)*chord
  def wing_y(x,z):
   for (xa,la,ta),(xb,lb,tb) in zip(wing,wing[1:]):
    if xa<=x<=xb:
     u=(x-xa)/(xb-xa)
     le=la+(lb-la)*u
     te=ta+(tb-ta)*u
     t=min(1,max(0,(le-z)/(le-te)))
     return .20-.021*x+2*math.sqrt(t*(1-t))*half_depth(x,le-te,t)-.055*(1-t)**7
  for x,le,te in wing:
   centre=.20-.021*x
   chord=le-te
   section=[]
   for i in range(32):
    a=math.tau*i/32
    t=(1-math.cos(a))/2
    thick=math.sin(a)*half_depth(x,chord,t)
    section.append((side*x,centre+thick-.055*(1-t)**7,le-t*chord))
   sections.append(section)
  fighter_shell('Wing and curved leading edge root',sections,'GhostGrey')
  for part,x0,x1,te0,te1 in [('Flap',1.60,4.66,-4.22,-4.15),('Aileron',4.68,6.71,-4.15,-3.84)]:
   name=part+letter
   y=.20-.021*(x0+x1)/2
   pivot(name,(side*(x0+x1)/2,y,-3.25))
   airfoil(part,side,[(x0,-3.25,te0),(x1,-3.25,te1)],y,'GhostGrey',name)
  name='Elevator'+letter
  pivot(name,(side*1.36,.04,-6.69))
  airfoil('Stabilator',side,[(1.08,-5.16,-8.08),(1.67,-5.48,-8.49),
          (3.91,-7.14,-8.58),(4.09,-7.37,-8.08)],.04,'GhostGrey',name)
  def fin(y,z,offset=0):
   return (side*(.99+.364*(y-.49)+offset),y,z)
  # A common unswept hinge line follows the 20 degree cant of the rudder.
  hinge=-6.57
  sections=[]
  for y,le,w in [(.48,-3.56,.105),(.89,-3.87,.10),(3.36,-5.27,.058),(3.65,-5.53,.042)]:
   sections.append([fin(y,z,d*w) for z,d in [(le,0),(le-.13, .75),((le+hinge)/2,1),
                     (hinge,.32),(hinge,-.32),((le+hinge)/2,-1),(le-.13,-.75)]])
  fighter_shell('Canted fin',sections,'GhostGrey')
  name='Rudder'+letter
  pivot(name,fin(1.99,hinge-.012))
  sections=[]
  for y,te in [(.52,-7.24),(1.00,-7.36),(3.60,-6.93)]:
   sections.append([fin(y,z,d) for z,d in [(hinge-.012,.029),(te,.009),(te,-.009),(hinge-.012,-.029)]])
  fighter_shell('Rudder',sections,'GhostGrey',name)
  ellipsoid('Fin tip antenna',fin(3.63,-6.09),(.076,.082,.66),'GhostGrey',n=20,k=8)
  # Red flash with a narrow white keyline and dark fin cap; markings sit on both surfaces.
  def panel(y0,y1,z0,z1,d,m):
   mesh('Fin marking',[fin(y0,z0,d),fin(y1,z0-.19,d),fin(y1+.12,z1,d),fin(y0+.12,z1,d)],[(0,1,2,3)],m)
  for d in [-.064,.064]:
   panel(2.93,3.03,-5.20,-6.55,d,'WhiteMarking')
   panel(3.03,3.27,-5.27,-6.55,d,'SafetyRed')
  # Lettering lies in the fin plane, so both the baseline and the upright follow the skin.
  for text,y,z,size in [('TW',2.22,-5.88,.50),('07',1.77,-5.83,.32)]:
   key=('Static','Stencil')
   start=len(BATCH.get(key,([],[]))[0])
   text_mesh(text,fin(y,z,.11),size,'Stencil',rotation=(math.pi/2,0,side*math.pi/2),extrude=0)
   vs=BATCH[key][0]
   for i in range(start,len(vs)):
    x,yy,zz=vs[i]
    vs[i]=(fin(yy,zz,.106)[0],yy,zz)
  intake_duct(side)
  # Tip rail has a tapered nose, parallel guide shoes and paired position lights.
  rail=[]
  for z,w,h in [(-4.09,.055,.045),(-3.94,.093,.10),(-1.36,.098,.104),(-1.04,.072,.077),(-.77,.02,.027)]:
   rail.append([(side*(6.74+w*math.cos(math.tau*i/8)),.066+h*math.sin(math.tau*i/8),z) for i in range(8)])
  fighter_shell('Tip rail',rail,'AircraftLight')
  ellipsoid('Position lamp',(side*6.796,.078,-1.50),(.047,.056,.13),'GreenLight' if side>0 else 'RedLight',n=16,k=8)
  box('Tip formation strip',(side*6.837,.060,-2.21),(.008,.044,.51),'WarmLight')
  def wing_pt(x,z,lift=.005):
   return (side*x,wing_y(x,z)+lift,z)
  for x,width in [(3.22,.006),(4.68,.012),(6.16,.005)]:
   le=1.02-(x-2.30)*.45
   points=[wing_pt(x+offset,le-(le+3.21)*i/16) for i in range(17) for offset in [-width,width]]
   mesh('Panel break',points,[(i,i+1,i+3,i+2) for i in range(0,32,2)],'Stencil')
  for z in [-.79,-1.73,-2.66]:
   ellipsoid('Wing fold knuckle',wing_pt(4.68,z),(.046,.037,.13),'GhostGrey',n=8,k=4)
  for x in [2.8,3.6,5.5]:
   ellipsoid('Flap track cover',(side*x,.05,-3.18),(.073,.077,.32),'GhostGrey',n=10,k=4)
  line('Leading edge flap hinge',[wing_pt(x,le-.15*(le-te)) for x,le,te in wing[6:]],.008,'Stencil',n=4)
  for i in range(5):
   x,z=.92+i*.086,2.65-i*.28
   mesh('Bleed slot',[wing_pt(x+dx,z+dz) for dx,dz in [(-.022,-.10),(.022,-.10),(.022,.10),(-.022,.10)]],[(0,1,2,3)],'Stencil')
  x=1.60
  mesh('LEX fence',[wing_pt(x,z,lift) for z,lift in [(1.24,0),(.99,.13),(.68,.12),(.63,0)]],[(0,1,2,3)],'GhostGrey')
  # Low-visibility star and bars on the port upper wing; squadron number opposite.
  if side<0:
   def insignia(poly,finish,h):
    mesh('National insignia',[wing_pt(3.68+dx,-1.24+dz,h) for dx,dz in poly],[tuple(range(len(poly)))],finish)
   def disc(r):
    return [(r*math.cos(math.tau*i/32),r*math.sin(math.tau*i/32)) for i in range(32)]
   insignia([(-.87,-.15),(.87,-.15),(.87,.15),(-.87,.15)],'Stencil',.009)
   insignia([(-.81,-.105),(.81,-.105),(.81,.105),(-.81,.105)],'LightGhost',.015)
   insignia(disc(.38),'Stencil',.024)
   insignia([((.35 if i%2==0 else .14)*math.sin(math.pi*i/5),(.35 if i%2==0 else .14)*math.cos(math.pi*i/5)) for i in range(10)],'LightGhost',.028)
  else:
   start=len(BATCH['Static','Stencil'][0])
   text_mesh('NAVY',(3.94,0,-1.67),.44,'Stencil',rotation=(0,0,math.pi),extrude=0)
   vs=BATCH['Static','Stencil'][0]
   for i in range(start,len(vs)):
    x,y,z=vs[i]
    vs[i]=(x,wing_y(x,z)+.007+y,z)
 # Canopy has no lower glass inside the cockpit. Smooth sampled half-ellipses
 # carry the bows and sills on the same surface as the glazing.
 sections=[]
 for i in range(31):
  t=i/30
  z=1.19+4.22*t
  radius=max(.008,math.sin(math.pi*t)**.70)
  w=.616*radius
  y=.84+.12*math.sin(math.pi*t)
  h=(1.13-.48*t)*radius
  arc=[(w*math.cos(math.pi*j/24),y+h*math.sin(math.pi*j/24),z) for j in range(25)]
  sections.append(arc)
  if i==5:
   fighter_tube('Aft canopy bow',arc,.040,'Graphite',6)
 verts=[v for section in sections for v in section]
 faces=[(j*25+i,(j+1)*25+i,(j+1)*25+i+1,j*25+i+1) for j in range(30) for i in range(24)]
 mesh('Single seat bubble canopy',verts,faces,'Canopy')
 for i in [0,-1]:
  fighter_tube('Canopy sill',[section[i] for section in sections],.040,'Graphite',6)
 # Keep the exterior lip, with a recessed well between the two rails.
 for side in (-1,1):
  fighter_shell('Cockpit sill fairing',[
   [(side*w*f,y+h*dy,z) for f,dy in [(1,0),(.96,.48),(.86,.77),(.80,.74),(.78,-.4),(.9,-.85)]]
   for z,w,h,y in [(1.19,.11,.09,.87),(1.67,.39,.16,.86),(2.24,.52,.17,.88),
                   (3.25,.62,.15,.87),(4.06,.51,.15,.86),(4.84,.32,.12,.84),(5.41,.04,.06,.79)]],'GhostGrey')
 fighter_gear()
 pivot('ArrestorHook',(0,-.51,-5.65))
 tip=(0,-.56,-8.33)
 rod('Hook shank',PIVOTS['ArrestorHook'],tip,.064,'SteelDark','ArrestorHook')
 for i in range(5):
  t=(i+1)/7
  z=-5.65-2.68*t
  y=-.51-.05*t
  rod('Hook stripe',(0,y,z),(0,y-.002,z-.12),.066,'SafetyYellow','ArrestorHook')
 line('Forged hook shoe',[tip,(0,-.68,-8.39),(0,-.73,-8.20),(0,-.68,-8.10)],.086,'SteelDark','ArrestorHook')


def fighter_gear():
 for name,x,z,piv in [('GearNose',0,5.3,(0,-.48,4.58)),('GearLeft',-2.65,-1.7,(-2.81,.08,-1.7)),('GearRight',2.65,-1.7,(2.81,.08,-1.7))]:
  pivot(name,piv)
  nose=x==0
  radius=.34 if nose else .45
  cy=-2+radius
  knee=(x*.94,-1.27,z+(.0 if nose else .53))
  rod('Upper oleo',piv,knee,.095 if nose else .121,'SteelGrey',name,n=16)
  rod('Swing arm',knee,(x,cy,z),.078 if nose else .104,'SteelGrey',name,n=12)
  rod('Oleo piston',(piv[0],-.73,z-.18),(x,cy+.10,z-.02),.059,'BrightMetal',name,n=12)
  line('Torque links',[(knee[0],-.95,knee[2]),(knee[0],-1.18,knee[2]+.21),knee],.034,'SteelDark',name)
  line('Brake hose',[piv,(knee[0]+.10,-1.0,z+.20),(x+.10,cy,z)],.018,'Rubber',name)
  for wx in ([-.17,.17] if nose else [x]):
   width=.097 if nose else .132
   ring('Carrier tyre',(wx,cy,z),radius-width,width,'Rubber',normal=(1,0,0),group=name,n=32,k=8)
   rod('Wheel casting',(wx-width,cy,z),(wx+width,cy,z),radius*.52,'SteelGrey',name,n=20)
   for s in [-1,1]:
    ring('Wheel rim',(wx+s*width,cy,z),radius*.40,.024,'BrightMetal',normal=(1,0,0),group=name,n=16,k=4)
    for i in range(8):
     a=math.tau*i/8
     y=cy+.27*radius*math.cos(a)
     zz=z+.27*radius*math.sin(a)
     if nose and s*wx<0:continue
     rod('Hub lug',(wx+s*width,y,zz),(wx+s*(width+.015),y,zz),.016,'SteelDark',name,n=4)
  if nose:
   rod('Launch bar',(0,-1.37,5.31),(0,-1.78,5.94),.048,'SteelGrey',name)
   rod('Launch bar foot',(-.13,-1.78,5.94),(.13,-1.78,5.94),.045,'SteelDark',name)
   ellipsoid('Taxi lamp',(0,-.92,5.17),(.113,.112,.075),'BrightMetal',name,n=14,k=6)
  sign=1 if x>=0 else -1
  xx=piv[0]+sign*(.31 if nose else .07)
  top=piv[1]
  edge=-.96 if nose else -.78
  mesh('Open gear bay door',[(xx,top,z+.69),(xx,top,z-.55),(xx+sign*.18,edge,z-.38),
       (xx+sign*.18,edge,z+.56)],[(0,1,2,3)],'AircraftLight',name)

def line(name,points,r,m,group='Static',n=6):
 for a,b in zip(points,points[1:]):rod(name,a,b,r,m,group,n)

def railing(x0,x1,z0,z1,y,m='SteelGrey'):
 corners=[(x0,z0),(x1,z0),(x1,z1),(x0,z1),(x0,z0)]
 for (x,z),(xx,zz) in zip(corners,corners[1:]):
  for h in [.42,1.05]:rod('Gallery handrail',(x,y+h,z),(xx,y+h,zz),.045,m,n=6)
  count=max(1,int(math.hypot(xx-x,zz-z)/2.1))
  for i in range(count+1):
   t=i/count;rod('Gallery upright',(x+(xx-x)*t,y,z+(zz-z)*t),(x+(xx-x)*t,y+1.05,z+(zz-z)*t),.047,m,n=6)

def deck_vehicle(x,z,yaw=0,kind='tractor'):
 # Complete local vehicle assemblies, transformed into the same material batches.
 base={key:len(value[0])for key,value in BATCH.items()}
 y=18.08
 box('Tug chassis',(0,y+.42,0),(2.3,.48,4.2),'SteelDark');box('Tug fender',(0,y+.93,-.55),(2.6,.7,2.8),'SafetyYellow')
 for side in [-1,1]:
  for az in [-1.34,1.32]:
   ring('Industrial tyre',(side*1.16,y+.5,az),.37,.13,'Rubber',normal=(1,0,0),n=16,k=6)
   rod('Tug wheel hub',(side*1.1,y+.5,az),(side*1.33,y+.5,az),.25,'SteelGrey',n=12)
  box('Tug footboard',(side*1.05,y+.63,.72),(.45,.13,1),'SteelGrey')
  for k in range(4):box('Tug engine cooling slit',(side*1.31,y+1.0,-1.35+k*.24),(.035,.37,.12),'SteelDark')
  ellipsoid('Tug headlamp',(side*.8,y+.9,2.12),(.18,.12,.04),'WarmLight',n=8,k=4)
  rod('Tug grab handle',(side*.85,y+1.35,.65),(side*.85,y+1.7,.65),.04,'SteelGrey')
 box('Tug bonnet',(0,y+1.1,1.42),(2.4,.5,1.3),'SafetyYellow');box('Driver seat',(0,y+1.27,.2),(.65,.3,.65),'Black');box('Driver backrest',(0,y+1.56,-.12),(.65,.72,.15),'Black')
 rod('Steering column',(0,y+1,.75),(0,y+1.7,.9),.055,'SteelDark');ring('Steering wheel',(0,y+1.7,.9),.25,.027,'Rubber',normal=(0,1,-.4),n=12,k=4)
 for sign in [-1,1]:rod('Tow clevis',(sign*.16,y+.4,-2),(sign*.16,y+.4,-2.6),.07,'BrightMetal')
 ring('Tow attachment',(0,y+.4,-2.65),.17,.055,'BrightMetal',normal=(0,1,0),n=12,k=4)
 for zz in [-1.65,-1,-.35]:box('Tug hazard stripe',(0,y+1.3,zz),(2.45,.035,.14),'Black',yaw=-.15)
 text_mesh('T 04',(0,y+1.37,1.4),.35,'SteelDark',rotation=(0,0,0))
 if kind=='power':
  box('Power unit',(0,y+1.8,-.8),(1.9,1.1,2),'HullGrey')
  for k in range(7):box('Power unit louvre',(-.96,y+1.8,-1.65+k*.25),(.04,.75,.11),'SteelDark')
  ring('Hose reel',(1.15,y+1.7,-.8),.5,.14,'Black',normal=(1,0,0),n=20,k=5)
  rod('Power beacon',(0,y+2.34,-.8),(0,y+2.7,-.8),.14,'Orange',n=10)
 co,si=math.cos(yaw),math.sin(yaw)
 for key,(verts,_) in BATCH.items():
  for i in range(base.get(key,0),len(verts)):
   vx,vy,vz=verts[i];verts[i]=(x+vx*co+vz*si,vy,z-vx*si+vz*co)

def deck_crew(x,z,vest='SafetyYellow',yaw=0):
 # Small helmeted deck crew give a truthful human-scale reference.
 y=18.1
 for side in [-1,1]:
  rod('Crew boot',(x+side*.14,y+.08,z-.1),(x+side*.14,y+.08,z+.14),.095,'Black',n=8)
  rod('Crew trouser',(x+side*.14,y+.16,z),(x+side*.12,y+.9,z),.115,'AircraftGrey',n=8)
 ellipsoid('Crew vest',(x,y+1.12,z),(.29,.35,.17),vest,n=10,k=6)
 for side in [-1,1]:rod('Crew sleeve',(x+side*.24,y+1.3,z),(x+side*.38,y+.86,z+.09),.09,vest,n=8);ellipsoid('Crew hand',(x+side*.38,y+.85,z+.09),(.075,.1,.07),'HullPanelGrey',n=8,k=4)
 ellipsoid('Crew head',(x,y+1.59,z),(.14,.17,.14),'HullPanelGrey',n=10,k=6);ellipsoid('Crew cranial helmet',(x,y+1.69,z),(.17,.13,.17),'WhiteMarking',n=10,k=6)
 box('Crew reflective vest',(x,y+1.11,z+.17),(.35,.07,.018),'WhiteMarking');box('Crew goggles',(x,y+1.62,z+.13),(.25,.065,.04),'Glass')

def carrier_detail():
 # Layered bridge platforms, support brackets, window frames and external services.
 for y,x0,x1,z0,z1 in [(25,19,35,-24,27),(31,19.7,35,-18,25),(36,18.8,36,-10,23),(40,20.2,35,-7,19),(45,21,34,-3,15)]:
  prism('Overhanging island gallery',[(x0,z0),(x1,z0),(x1,z1),(x0,z1)],y-.18,y+.05,'SteelGrey');railing(x0,x1,z0,z1,y+.05)
  for z in range(int(z0)+2,int(z1),5):rod('Gallery bracket',(x0+1.6,y-1.8,z),(x0,y-.18,z),.1,'SteelDark',n=6)
 for y,z0,z1,x0,x1 in [(29,-20,24,20.43,34.17),(38,-6,20,19.53,35.17),(41.5,-4,16,21.13,34.17)]:
  for z in range(int(z0),int(z1),3):
   for x in [x0,x1]:
    line('Window frame',[(x,y-.68,z-.14),(x,y+.68,z-.14),(x,y+.68,z+2.14),(x,y-.68,z+2.14),(x,y-.68,z-.14)],.055,'SteelGrey')
    rod('Bridge wiper',(x-.035,y-.52,z+.25),(x-.035,y+.3,z+1.1),.018,'Black',n=4)
 for z in [-21,-15,-8,3,13,21]:
  for j in range(7):box('Vent horizontal blade',(19.91,22.6+j*.16,z),(.16,.065,1.35),'SteelDark')
 for x in [23.5,32.8]:
  for z in [-19,-9,8,20]:
   rod('Vertical utility pipe',(x,19,z),(x,25,z),.075,'SteelDark');rod('Pipe elbow',(x,24.8,z),(x+.5,24.8,z),.075,'SteelDark')
   box('Junction box',(x,20.8,z),(.55,.7,.28),'HullPanelGrey')
 for x,z in [(19.4,-19),(34.8,11)]:
  for dx in [0,.6]:rod('Access ladder stringer',(x+dx,19,z),(x+dx,31,z),.047,'SteelGrey')
  for y in range(38,61):rod('Access ladder rung',(x, y*.5,z),(x+.6,y*.5,z),.043,'SteelGrey')
 # Mast bracing, sensor horns, a genuinely concave surveillance dish and cabling.
 for y in [46,49,52,55]:
  rod('Mast cross brace',(24,y,5),(31,y+3,6),.09,'SteelDark');rod('Mast reverse brace',(31,y,5),(24,y+3,6),.09,'SteelDark')
 for x,z in [(22,2),(33,8)]:
  box('Sensor housing',(x,46.7,z),(1.1,.9,1.5),'SteelDark');rod('Sensor horn',(x,46.7,z+.7),(x,46.7,z+1.65),.2,'SteelGrey',n=10)
 cx,cy,cz=30,50,-15;v=[];n=28;k=6
 for j in range(k+1):
  r=2.1*j/k
  for i in range(n):
   a=math.tau*i/n;v.append((cx+r*math.cos(a),cy+r*math.sin(a),cz+.19*r*r))
 mesh('Parabolic radar reflector',v,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)for j in range(k)for i in range(n)],'SteelGrey')
 ring('Radar dish rim',(cx,cy,cz+.19*2.1**2),2.1,.065,'BrightMetal',normal=(0,0,1),n=28,k=5)
 for a in [0,math.tau/3,math.tau*2/3]:rod('Dish feed strut',(cx+2*math.cos(a),cy+2*math.sin(a),cz+.76),(cx,cy,cz+2.4),.045,'SteelDark')
 rod('Dish feed',(cx,cy,cz+2.1),(cx,cy,cz+2.6),.16,'Black',n=12);rod('Dish pedestal',(cx,46,cz),(cx,cy-1.4,cz),.27,'SteelDark',n=12)
 for x in [24,31]:line('Mast conduit',[(x,43,4.5),(x,48,4.5),(27.5,55,5)],.035,'Black')
 # Deck lanes read at a distance; smaller procedural lettering survives close inspection.
 heading=-math.radians(7);ss,cc=math.sin(heading),math.cos(heading)
 def lane(x,z,y=18.11):return(-9+x*cc+z*ss,y,-142-x*ss+z*cc)
 for side in [-1,1]:
  for z in range(12,177,6):paint_line('Recovery hazard dashes',lane(side*14,z),lane(side*14,z+2.8),.28,'SafetyRed'if(z//6)%2 else'WhiteMarking')
 for index,z in enumerate([30,42,54,66],1):
  for side in [-1,1]:
   x,y,zz=lane(side*13.1,z)
   box('Wire sheave housing',(x,y+.2,zz),(1.6,.38,2.1),'SteelDark',yaw=heading)
   ring('Exposed wire sheave',(x,y+.41,zz),.45,.09,'BrightMetal',normal=(0,1,0),n=18,k=5)
   box('Arrestor access plate',(x+side*1.65,18.12,zz),(1.2,.12,1.8),'SteelGrey',yaw=heading)
   for dx in [-.43,.43]:
    for dz in [-.65,.65]:rod('Access plate bolt',(x+side*1.65+dx,18.2,zz+dz),(x+side*1.65+dx,18.24,zz+dz),.045,'SteelDark',n=6)
   text_mesh(str(index),(x+side*2.8,18.13,zz),1.25,'SafetyYellow',rotation=(0,0,-heading))
 for x in [8,21]:
  for z in range(26,128,4):
   box('Catapult rail expansion plate',(x,18.08,z),(1.3,.055,.33),'SteelGrey')
   for dx in [-.52,.52]:rod('Catapult clamp bolt',(x+dx,18.14,z),(x+dx,18.18,z),.065,'SteelDark',n=6)
  box('Launch shuttle lower shoe',(x,18.2,24),(1.25,.18,2.3),'SteelDark');box('Shuttle tow lug',(x,18.45,24.5),(.55,.42,.65),'BrightMetal')
  for dx in [-3.5,3.5]:
   rod('Deflector hydraulic cylinder',(x+dx,18.25,10),(x+dx,19.4,11),.22,'SteelDark',n=12);rod('Deflector chrome piston',(x+dx,19.35,10.95),(x+dx,20.7,12),.115,'BrightMetal',n=12)
  for k in range(9):box('Blast panel rib',(x-4+k,19.05,12.8),(.055,1.7,2.4),'SteelGrey')
  text_mesh('JET BLAST',(x,18.13,7),1.0,'SafetyYellow',rotation=(0,0,0));text_mesh('CAT '+('1'if x==8 else'2'),(x,18.13,133),1.35,'WhiteMarking',rotation=(0,0,0))
 for i,(x,z,w,l) in enumerate([(29,-80,13,25),(29,65,13,25),(-34,-95,14,23)],1):
  text_mesh('ELEVATOR '+str(i),(x,18.16,z-3),.9,'WhiteMarking',rotation=(0,0,0));text_mesh('KEEP CLEAR',(x,18.16,z+1),.7,'SafetyYellow',rotation=(0,0,0))
  for side in [-1,1]:
   for az in range(-int(l/2),int(l/2),2):box('Elevator hazard block',(x+side*(w/2-.35),18.17,z+az),(.55,.04,1),'SafetyYellow')
 # Small non-slip hatches, tie-down service points and wheel chocks near parking areas.
 for x,z in [(-29,-30),(-31,9),(-31,50),(27,38),(28,99),(21,-139),(-24,118)]:
  box('Flush service hatch',(x,18.08,z),(2.1,.08,2.6),'HullPanelGrey')
  for xx in [x-.9,x+.9]:box('Hatch rim',(xx,18.13,z),(.055,.04,2.45),'SteelDark')
  rod('Flush hatch handle',(x-.3,18.18,z),(x+.3,18.18,z),.045,'BrightMetal');text_mesh('FUEL',(x,18.15,z+.8),.28,'WhiteMarking',rotation=(0,0,0))
 for x,z,yaw,kind in [(-31,40,.2,'tractor'),(28,-108,-.25,'tractor'),(29,96,.15,'power'),(-31,-47,0,'power')]:deck_vehicle(x,z,yaw,kind)
 for x,z in [(-29,45),(-28,38),(26,-110),(26,98),(18,8),(-24,97)]:deck_crew(x,z,'SafetyYellow'if z%2 else'SafetyRed')
 # Rope barriers, rolled hoses and fire lockers occupy only the service margins.
 for x,z in [(-35,16),(34,40),(-30,-126)]:
  box('Fire equipment locker',(x,19.08,z),(1.05,1.9,1.9),'SafetyRed');box('Locker plaque',(x-.54,19.3,z),(.03,.5,.8),'WhiteMarking')
  ring('Fire hose reel',(x-.64,19.22,z),.48,.15,'Black',normal=(1,0,0),n=20,k=6)
  line('Hose end',[(x-.64,19.2,z),(x-.64,18.2,z+.6),(x-.4,18.1,z+1.6)],.055,'Black')
 for x,z in [(-33,-50),(32,103),(-33,48)]:
  for off in [-3,0,3]:rod('Safety barrier post',(x,18.1,z+off),(x,19.25,z+off),.08,'SafetyYellow')
  for h in [18.5,19.1]:rod('Safety barrier rail',(x,h,z-3),(x,h,z+3),.06,'SafetyYellow')
 # Full mesh of safety net cables instead of only long outer frames.
 outline=[(-27,-160),(27,-160),(36,-135),(36,68),(28,145),(18,160),(-18,160),(-34,110),(-42,35),(-42,-70),(-35,-145)]
 for (x,z),(xx,zz) in zip(outline,outline[1:]+outline[:1]):
  distance=math.hypot(xx-x,zz-z);nx=(zz-z)/distance;nz=-(xx-x)/distance;n=max(1,int(distance/.8))
  for j in range(n):
   t=(j+.5)/n;px=x+(xx-x)*t;pz=z+(zz-z)*t
   rod('Safety net transverse',(px,17.32,pz),(px+nx*2.1,17.5,pz+nz*2.1),.018,'SteelDark',n=4)
 # Visible hull maintenance seams, deep portholes, anchor hawse and embarkation ladders.
 for side in [-1,1]:
  for z in range(-118,104,12):
   rod('Hull weld seam',(side*20.02,1.5,z),(side*20.02,7,z),.025,'HullPanelGrey',n=4)
   ring('Gallery life ring',(side*24,15.2,z),.48,.11,'Orange',normal=(1,0,0),n=16,k=5)
  for z in [78,104,125]:
   ring('Hull porthole bezel',(side*(19 if z<100 else 15),9,z),.45,.065,'BrightMetal',normal=(1,0,0),n=16,k=5)
  line('Anchor shank',[(side*12,7,123),(side*12,4,123),(side*10.5,3.3,123)],.3,'SteelDark',n=10)
  rod('Anchor fluke',(side*10.5,3.3,123),(side*13.5,3.3,123),.32,'SteelDark',n=10)
  for k in range(7):ring('Anchor chain link',(side*12,7+k*.45,123),.23,.07,'SteelDark',normal=(1,0,0)if k%2 else(0,0,1),n=10,k=4)
 text_mesh('TIDEWATER 07',(19.91,23,-1),1.2,'WhiteMarking',rotation=(math.pi/2,0,-math.pi/2))

def intake_duct(side):
 # Rounded corners on the canted lip lead into the recessed cheek tunnel.
 corners=[(.80,-.62),(1.63,-.68),(1.92,.02),(1.04,.17)]
 outline=[]
 for i,(x,y) in enumerate(corners):
  prev=corners[i-1]
  nxt=corners[(i+1)%4]
  for t in [0,.25,.5,.75,1]:
   outline.append((x+.09*((1-t)**2*(prev[0]-x)+t*t*(nxt[0]-x)),
                   y+.09*((1-t)**2*(prev[1]-y)+t*t*(nxt[1]-y))))
 def contour(scale,z,slant):
  return [(side*(1.35+(x-1.35)*scale),-.25+(y+.25)*scale,z+slant*(1.35-x)) for x,y in outline]
 def sleeve(sections,m):
  n=len(outline)
  mesh('Intake shell',[v for sec in sections for v in sec],
       [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(sections)-1) for i in range(n)],m)
 lip=contour(1,2.60,.46)
 rim=contour(.90,2.59,.46)
 sleeve([contour(.67,-3.20,0),contour(1.07,-.70,0),contour(1.04,1.65,.28),lip],'LightGhost')
 sleeve([lip,rim,contour(.88,2.45,.42)],'GhostGrey')
 sleeve([rim,contour(.82,1.28,.12),contour(.70,.47,0)],'Graphite')
 mesh('Compressor shadow',contour(.70,.46,0),[tuple(range(len(lip)))],'Black')
 for i in range(16):
  a=math.tau*i/16
  mesh('Compressor vane',[(side*(1.35+r*math.cos(t)),-.25+r*math.sin(t),.49+d)
       for r,t,d in [(.058,a,0),(.245,a+.15,0),(.248,a+.33,.02),(.060,a+.16,.02)]],[(0,1,2,3)],'SteelDark')
 mesh('Splitter plate',[(side*.78,-.58,2.96),(side*.99,.16,2.98),(side*1.04,.15,1.75),(side*.83,-.62,1.64)],[(0,1,2,3)],'LightGhost')
 mesh('Intake danger flash',[(side*1.887,-.13,2.18),(side*1.835,-.28,1.67),(side*1.918,-.067,1.67)],[(0,1,2)],'SafetyRed')


def fighter_detail():
 for side in [-1,1]:
  x=side*.685
  def nozzle(r,z,a):
   return (x+r*math.cos(a),r*math.sin(a),z)
  for i in range(20):
   a=math.tau*i/20
   b=math.tau*(i+1)/20
   # Faceted titanium feathers overlap the narrow, darker under-petals.
   mesh('Exhaust petal',[nozzle(r,z,t) for r,z,t in
        [(.641,-7.32,a),(.641,-7.32,b),(.637,-7.77,b),(.537,-8.65,b-.013),
         (.546,-8.65,a+.026),(.65,-7.77,a)]],[(0,1,2,3,4,5)],'SteelDark' if i%2 else 'Titanium')
   mesh('Petal edge',[nozzle(r,z,t) for r,z,t in [(.651,-7.77,a),(.652,-7.77,a+.035),
        (.551,-8.64,a+.032),(.55,-8.65,a+.019)]],[(0,1,2,3)],'BrightMetal')
  for z,r in [(-7.45,.640),(-7.75,.64)]:
   ring('Nozzle collar',(x,0,z),r,.021,'SteelGrey',normal=(0,0,1),n=36,k=4)
  n=40
  rings=[[nozzle(r,z,math.tau*i/n) for i in range(n)] for z,r in [(-8.65,.532),(-8.50,.514),(-7.98,.491)]]
  mesh('Nozzle liner',sum(rings,[]),[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(2) for i in range(n)],'Graphite')
  rod('Turbine recess',(x,0,-7.96),(x,0,-7.97),.50,'Black',n=40)
  for r in [.22,.39,.487]:
   ring('Flameholder',(x,0,-8.08),r,.018,'SteelDark',normal=(0,0,1),n=24,k=3)
  ellipsoid('Exhaust cone',(x,0,-8.08),(.12,.12,.25),'SteelDark',n=14,k=6)
  for z,height in [(-4.26,.765),(-2.87,.796)]:
   pts=[(side*(.82+.20*math.cos(math.tau*i/20)),height,z+.28*math.sin(math.tau*i/20)) for i in range(21)]
   fighter_tube('Engine access hatch',pts,.008,'Stencil',4)
  for z in [-1.6,-1.42,-1.24,-1.06,-.88]:
   box('Heat vent',(side*.78,.794,z),(.30,.018,.061),'Stencil')

 fighter_cockpit()


def fighter_tube(name,points,r,material,n=8):
 # Parallel transport keeps the cross section continuous through a bent rail.
 points=list(map(Vector,points))
 axis=Vector((0,0,1))
 if abs((points[1]-points[0]).normalized().dot(axis))>.9:
  axis=Vector((1,0,0))
 sections=[]
 for i,pt in enumerate(points):
  tangent=(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
  axis=(axis-tangent*axis.dot(tangent)).normalized()
  cross=tangent.cross(axis)
  radius=r(i/(len(points)-1)) if callable(r) else r
  sections.append([tuple(pt+radius*(axis*math.cos(j*math.tau/n)+cross*math.sin(j*math.tau/n))) for j in range(n)])
 fighter_shell(name,sections,material)


def fighter_cockpit():
 # All dimensions are in game metres. Registration is to the production eye at
 # (0,1.44,2.90). Display strokes are physical inlays because the rigid aircraft
 # loader reads PBR factors but does not sample decal textures.
 glass=MATS['Glass'].node_tree.nodes.get('Principled BSDF')
 glass.inputs['Base Color'].default_value=(.008,.021,.019,1)
 glass.inputs['Roughness'].default_value=.36
 glass.inputs['Metallic'].default_value=.08

 def plate(name,verts,material):
  mesh(name,verts,[tuple(range(len(verts)))],material)

 def rect(w,h,r):
  return [(-w+r,-h),(w-r,-h),(w,-h+r),(w,h-r),(w-r,h),(-w+r,h),(-w,h-r),(-w,-h+r)]

 def face(x,y,z,cant=0,rake=.20):
  # u increases to the pilot's right, d increases towards the eye.
  return lambda u,v,d=0:(x-u,y+v,z+v*rake+u*cant-d)

 def pad(name,P,u,v,w,h,r,d,material):
  plate(name,[P(u+a,v+b,d) for a,b in rect(w/2,h/2,r)],material)

 def stroke(P,points,width,material='GreenLight',d=.001):
  edges=[]
  for i,(u,v) in enumerate(points):
   a,b=points[max(0,i-1)],points[min(i+1,len(points)-1)]
   du,dv=b[0]-a[0],b[1]-a[1]
   scale=width/(2*math.hypot(du,dv))
   edges.extend((P(u-dv*scale,v+du*scale,d),P(u+dv*scale,v-du*scale,d)))
  mesh('Printed instrument stroke',edges,[(i,i+1,i+3,i+2) for i in range(0,len(edges)-2,2)],material)

 # Single-stroke lettering stays legible head-on at millimetre height without
 # spending the mesh budget extruding the sides and backs of printed glyphs.
 alphabet={
  'A':'03752 35','B':'067543 5410','C':'8602','D':'067520','E':'8602 34',
  'F':'068 35','G':'860254','I':'17','J':'85210',
  'K':'06 83 32','L':'602','M':'06482','N':'0628','O':'06820',
  'P':'06853','R':'06853 42','S':'863520','T':'68 71','U':'6028',
  'V':'618','W':'60428','Y':'648 41','0':'06820','1':'471',
  '2':'685302','3':'6820 45','4':'635 82','5':'863520','6':'860253',
  '7':'681','8':'06820 35','9':'53682','H':'06 35 28','X':'62 80','Z':'6802','.':'10'}
 def label(P,word,u,v,h,material='GreenLight',d=.002):
  for j,char in enumerate(word):
   for path in alphabet.get(char,'').split():
    stroke(P,[(u+j*h*.83+(int(k)%3)*h*.29,v+(int(k)//3)*h*.5) for k in path],h*.105,material,d)

 def arc(P,u,v,r,start,end,width,material='GreenLight',d=.001,n=32):
  stroke(P,[(u+r*math.sin(start+(end-start)*i/n),v+r*math.cos(start+(end-start)*i/n)) for i in range(n+1)],width,material,d)

 def bezel(P,w,h,border,softkeys=True):
  loops=[]
  for extent,depth in [(0,-.022),(0,.003),(-.003,.008),(-border+.003,.008),(-border,.001)]:
   loops.append([P(u,v,depth) for u,v in rect(w/2+extent,h/2+extent,.009)])
  mesh('Cast bezel',sum(loops,[]),[(j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i) for j in range(4) for i in range(8)],'Black')
  pad('Recessed display',P,0,0,w-2*border+.001,h-2*border+.001,.008,0,'Glass')
  if softkeys:
   for i in range(-2,3):
    for side in [-1,1]:
     for u,v,sw,sh in [(i*w*.14,side*(h-border)/2,.012,.0045),(side*(w-border)/2,i*h*.14,.0045,.012)]:
      pad('Membrane key',P,u,v,sw,sh,.001,.009,'Graphite')

 # Crown of the windscreen rakes aft. Sample the *same* glazing surface as the
 # bubble, from sill to sill, to keep the bow sealed along the entire arch.
 def bow(a):
  z=4.12-.58*math.sin(a)
  t=(z-1.19)/4.22
  radius=math.sin(math.pi*t)**.70
  return Vector((.616*radius*math.cos(a),.84+.12*math.sin(math.pi*t)+(1.13-.48*t)*radius*math.sin(a),z))
 fighter_tube('Windscreen bow',[bow(math.pi*i/64) for i in range(65)],lambda t:.022+.010*(2*t-1)**2,'Rubber',10)
 for angle in [.29*math.pi,.50*math.pi,.71*math.pi]:
  centre=bow(angle)
  down=Vector((-.616*math.cos(angle),-.85*math.sin(angle),0)).normalized()
  tangent=Vector((down.y,-down.x,.24*math.cos(angle))).normalized()
  mount=centre+down*.048
  rod('Mirror mount',centre,mount,.008,'Black')
  def mirror(u,v,d):
   return tuple(mount+tangent*u-down*v+Vector((0,0,v*.28-d)))
  fighter_shell('Mirror rim',[[mirror(u,v,d) for u,v in rect(.069+s,.029+s,.012)] for d,s in [(-.009,-.004),(0,0),(.005,-.002)]],'Black')
  pad('Polished mirror',mirror,0,0,.125,.045,.009,.0055,'BrightMetal')
 for side in [-1,1]:
  angle=.14*math.pi if side==1 else .86*math.pi
  points=[bow(angle+side*k*.031)+Vector((0,-dy,-dz)) for k,dy,dz in [(0,0,0),(1,.015,.045),(2,.018,.054),(5,.018,.054),(6,.015,.045),(7,0,0)]]
  fighter_tube('Canopy handhold',points,.009,'Graphite',8)

 def shelf(x,z):
  return 1.013+.065*(z-2.46)+.16*(abs(x)-.406)

 # A continuous rolled brow wraps around the three separately canted panels.
 sections=[]
 for i in range(41):
  x=(i-20)*.027
  t=abs(x)/.54
  crest=1.324+.050*math.exp(-((t-.55)/.32)**2)-.26*t**9
  lip=3.630-.225*t**2+.034*math.exp(-(t/.29)**2)
  sections.append([(x,crest+dy,lip+dz) for dz,dy in [(.012,-.036),(-.004,-.016),(0,-.003),(.014,.005),(.043,.008),(.12,.002),(.30,-.038),(.52,-.120),(.53,-.16),(.04,-.034)]])
 fighter_shell('Rolled coaming',sections,'Black')
 # Dark well and canted instrument rack behind the replaceable displays.
 for side in (-1,1):
  fighter_shell('Panel support',[
   [(side*x,y,z) for x,y in [(0,.81),(.45,.84),(.51,.99),(.48,1.18),(.41,1.27),(0,1.29)]]
   for z in (3.72,3.83)],'Graphite')
  console=[]
  for z,inner,outer in [(2.12,.25,.48),(2.46,.27,.52),(3.02,.28,.56),(3.44,.29,.53),(3.62,.30,.51)]:
   console.append([(side*x,shelf(x,z)+dy,z) for x,dy in [(inner,-.14),(inner,-.012),(inner+.013,0),(outer,0),(outer,-.14)]])
  fighter_shell('Console cheek',console,'Graphite')
  for j in range(6):
   z=2.42+j*.205
   def deck(u,v,d=0):
    return (side*(.406+u),shelf(.406+u,z+v)+d-.013,z+v)
   pad('Console access panel',deck,0,0,.174,.194,.007,.014,'Black')
   if side==1 and j in (2,3):continue
   def legend(u,v,d=0):
    return deck(-side*u,v,d+.015)
   label(legend,['L GEN','AUDIO','ANTI ICE','LIGHTS','CABIN','PWR'][j],-.069,-.058,.008,'AircraftLight')
   if j%2==1:
    rod('Selector dial',deck(-.045,.053,.015),deck(-.045,.053,.030),.013,'Black',n=10)
    pad('Pointer',deck,-.045,.058,.003,.009,.0007,.031,'SteelGrey')
   for k in (-1,0,1):
    rod('Toggle stem',deck(k*.049,.010,.015),deck(k*.049,.004,.038),.0035,'SteelGrey',n=5)
    pad('Switch legend',deck,k*.049,-.021,.024,.003,.0008,.016,'AircraftLight')
   if j%2==0:
    fighter_tube('Toggle guard',[deck(-.035,-.01,.015),deck(-.035,-.01,.045),deck(-.035,.042,.045),deck(-.035,.042,.015)],.0035,'SteelDark',5)

 for side in (-1,1):
  P=face(-side*.284,1.175,3.654,-side*.32)
  bezel(P,.265,.228,.016)
  if side==-1:
   # Twin-engine readout with separate N2, temperature and flow rows.
   for row,title in enumerate(['RPM','EGT','FF']):
    v=.047-row*.052
    label(P,title,-.011,v-.004,.008)
    for u in [-.067,.067]:
     arc(P,u,v,.021,-2.15,2.15,.0013,n=19)
     stroke(P,[(u,v),(u+.012,v+.012)],.0015)
     label(P,['82','410','64'][row],u-.011,v-.014,.008)
   label(P,'ENG',-.097,.076,.009)
  else:
   for k in range(-3,4):
    v=k*.018
    span=.046 if k%2==0 else .025
    stroke(P,[(-span,v),(-.007,v)],.0012)
    stroke(P,[(.007,v),(span,v)],.0012)
   arc(P,0,-.003,.078,-1.14,1.14,.0012)
   for k in range(-4,5):
    a=k*.24
    stroke(P,[(r*math.sin(a),-.003+r*math.cos(a)) for r in [.071,.079]],.0012)
   stroke(P,[(-.019,.003),(-.009,.003),(0,-.004),(.009,.003),(.019,.003)],.0021)
   label(P,'245',-.105,.01,.009)
   label(P,'1800',.069,.01,.008)
   label(P,'ATT',-.098,.077,.009)
  # Menu legends and engine graduation marks sit on the glass under the rim.
  label(P,'MENU',-.014,-.092,.0065)
  for i in [0,1,3,4]:
   u=(i-2)*.040
   stroke(P,[(u,-.086),(u,-.082)],.001)
  for edge in [-1,1]:
   for v in [-.084,.084]:
    pad('Captive screw',P,edge*.122,v,.005,.005,.0012,.0091,'SteelDark')
  if side==-1:
   for row in range(3):
    for u in [-.067,.067]:
     for a in [-1.7,-.85,0,.85,1.7]:
      stroke(P,[(u+r*math.sin(a),.047-row*.052+r*math.cos(a)) for r in [.0175,.020]],.001)
  else:
   for i in range(-2,3):
    label(P,str(abs(i)*5),.050,i*.018,.005)
   label(P,'KTS',-.102,-.003,.006)
   label(P,'ALT',.072,-.003,.006)
  annunciator=face(-side*.281,1.311,3.562,-side*.32)
  for j,title in enumerate(['FIRE','CAUT','L GEN'] if side==-1 else ['R GEN','WARN','FIRE']):
   u=(j-1)*.060
   pad('Annunciator window',annunciator,u,0,.057,.014,.002,.001,'Graphite')
   label(annunciator,title,u-.016,-.0035,.007,'SafetyYellow' if title=='CAUT' else 'Stencil',.002)
 P=face(0,1.213,3.679)
 bezel(P,.222,.155,.012,False)
 for j,word in enumerate(['COM 1','251.000','COM 2','305.000']):
  label(P,word,-.088,.044-j*.030,.009 if j%2==0 else .015)
 for i,char in enumerate('123456789'):
  u=.012+(i%3)*.029
  v=.038-(i//3)*.035
  pad('Touch target',P,u+.005,v+.004,.025,.026,.002,.001,'Black')
  label(P,char,u,v,.011,d=.0025)
 for u in [-.12,.12]:
  a,b=P(u,-.048,.002),P(u,-.048,.020)
  rod('UFCD encoder',a,b,.013,'Black',n=16)
  for k in range(8):
   a=k*math.tau/8
   rod('Knurled rim',P(u+.012*math.cos(a),-.048+.012*math.sin(a),.006),P(u+.012*math.cos(a),-.048+.012*math.sin(a),.018),.0015,'Graphite',n=4)

 P=face(0,1.012,3.584,0,.35)
 bezel(P,.208,.190,.014)
 for r in [.030,.058,.074]:
  arc(P,0,-.006,r,-math.pi,math.pi,.0011,n=32)
 for k in range(24):
  a=k*math.tau/24
  stroke(P,[(r*math.sin(a),-.006+r*math.cos(a)) for r in [.067 if k%3==0 else .071,.074]],.0013)
 stroke(P,[(-.05,-.043),(-.012,-.026),(.005,.012),(.051,.041)],.0012)
 label(P,'N',-.003,.059,.009)
 for side in [-1,1]:
  P=face(side*.203,.989,3.575,side*.24)
  for i in range(2):
   u=(i-.5)*.081
   rod('Instrument case',P(u,0,-.012),P(u,0,.007),.038,'SteelDark',n=24)
   rod('Dial face',P(u,0,.007),P(u,0,.008),.034,'Black',n=24)
   if i==0 and side==1:
    plate('Attitude hemisphere',[P(u+.029*math.cos(a*math.pi/16),.029*math.sin(a*math.pi/16),.009) for a in range(17)],'SteelGrey')
   for j in range(12):
    a=math.tau*j/12
    stroke(P,[(u+r*math.sin(a),r*math.cos(a)) for r in [.027,.032]],.0015,'AircraftLight',.010)
   stroke(P,[(u-.006,-.006),(u+.018,.019)],.0024,'WhiteMarking',.011)
  rod('Lever shaft',P(-side*.136,.066,0),P(-side*.128,.101,.079),.007,'SteelDark')
  ellipsoid('Gear wheel grip' if side==1 else 'Hook grip',P(-side*.128,.101,.079),(.017,.019,.010) if side==1 else (.030,.010,.012),'AircraftLight' if side==1 else 'Graphite',n=12,k=5)

 # HUD optical bench. Leave the combiner clear for the game's moving symbology.
 # Mask the short foredeck up to the windscreen seal. It slopes down with the
 # skin, leaving clear sky at the pilot's level flight sightline.
 fighter_shell('Anti-glare foredeck',[[(w*math.cos(a*math.pi/16),y+h*math.sin(a*math.pi/16),z) for a in range(17)]
  for z,w,y,h in [(3.87,.40,1.04,.220),(4.22,.38,1.015,.18),(4.55,.34,.955,.117),(4.90,.245,.88,.068),(5.32,.095,.822,.023)]],'Black')
 rod('Optical well',(0,1.255,3.814),(0,1.339,3.814),.075,'Graphite',n=32)
 ring('Projector retaining rim',(0,1.340,3.814),.066,.006,'Black',n=28,k=5)
 ellipsoid('Collimator',(0,1.340,3.814),(.061,.009,.061),'Glass',n=22,k=5)
 for s in [-1,1]:
  fighter_shell('HUD side casting',[[(s*(w+x),y,z+dz) for x,dz in [(-r,-d),(r,-d),(r,d),(-r,d)]]
   for w,y,z,r,d in [(.123,1.29,3.793,.019,.067),(.130,1.329,3.801,.015,.046),(.136,1.418,3.830,.009,.018),(.135,1.459,3.846,.009,.012)]],'Graphite')
  rod('Combiner trunnion',(s*.128,1.433,3.835),(s*.146,1.433,3.835),.012,'SteelDark',n=12)
 outline=[(-.12,1.360),(-.134,1.400),(-.134,1.532),(-.107,1.552),(.107,1.552),(.134,1.532),(.134,1.400),(.12,1.360)]
 fighter_shell('Combiner bevel',[[(x*f,y,3.797+(y-1.36)*.43+d) for x,y in outline] for d,f in [(0,.995),(.002,1),(.005,.995)]],'Canopy')

 # Throttle gate with two parallel fore/aft slots on the port shelf.
 for x in [.351,.403]:
  plate('Throttle gate',[(x+u,shelf(x+u,2.985+v)+.002,2.985+v) for u,v in rect(.013,.127,.008)],'Black')
 for i in range(6):
  z=2.87+i*.045
  plate('Quadrant index',[(.426+u,shelf(.426+u,z+v)+.003,z+v) for u,v in rect(.009,.0014,.0006)],'AircraftLight')
 # SJU-17 cushions, back pad, headbox and thigh bolsters follow the reclined pan.
 # A continuous dark footwell covers the fuselage crown below the controls.
 fighter_shell('Tub liner',[
  [(x,y,z) for x,y in [(-w,.991),(-w+.03,.894),(-w+.09,.851),(0,.850),(w-.09,.851),(w-.03,.894),(w,.991),(w,.839),(-w,.839)]]
  for w,z in [(.35,2.18),(.36,2.75),(.36,3.30),(.39,3.69)]],'Rubber')
 for side in [-1,1]:
  for j in range(4):
   rod('Rudder pedal tread',(side*.165-.043,.872+j*.013,3.465+j*.012),(side*.165+.043,.872+j*.013,3.465+j*.012),.004,'Graphite',n=5)
 def cushion(name,z,y,w,h,depth,lean,material):
  fighter_shell(name,[[(a*f,y+b*f,z+lean*b+d) for a,b in rect(w/2,h/2,min(w,h)*.19)] for f,d in [(.83,-depth),(.98,-depth*.75),(1,-depth*.21),(.91,0),(.64,.009)]],material)
 cushion('Seat back',2.40,1.235,.415,.54,.10,-.26,'Rubber')
 cushion('Headbox',2.33,1.562,.328,.226,.17,-.20,'Graphite')
 cushion('Head pad',2.348,1.554,.236,.14,.04,-.20,'Rubber')
 ellipsoid('Seat pan',(0,.947,2.64),(.244,.087,.29),'Rubber',n=20,k=6)
 for side in [-1,1]:
  ellipsoid('Thigh bolster',(side*.212,1.005,2.64),(.043,.083,.251),'Black',n=14,k=6)
  rod('Breaker tip',(side*.139,1.64,2.22),(side*.178,1.722,2.19),.011,'SteelDark',n=6)
  strap=[(side*x,y,z) for x,y,z in [(.133,1.49,2.36),(.115,1.45,2.385),(.101,1.32,2.402),(.151,1.126,2.455),(.179,1.028,2.65)]]
  mesh('Harness webbing',[(x+off,y,z+.015) for x,y,z in strap for off in [-.022,.022]],[(j,j+1,j+3,j+2) for j in range(0,8,2)],'Stencil')
  rod('Harness keeper',(side*.106-.022,1.31,2.423),(side*.106+.022,1.31,2.423),.004,'SteelGrey',n=6)
  rod('Throttle arm',(.377+side*.026,1.017,2.962),(.377+side*.026,1.138,2.993),.011,'SteelDark')
  fighter_shell('Split throttle grip',[
   [(.377+side*.027+rx*math.cos(a*math.tau/12),y+ry*math.sin(a*math.tau/12),z) for a in range(12)]
   for z,y,rx,ry in [(2.925,1.142,.014,.014),(2.936,1.148,.024,.027),(2.959,1.155,.026,.030),
                      (2.997,1.149,.024,.027),(3.020,1.138,.023,.024),(3.034,1.133,.016,.016)]],'Black')
  if side==-1:
   rod('Throttle rocker',(.328,1.15,2.962),(.321,1.15,2.962),.008,'Graphite',n=8)
 for j in range(20):
  a,b=j*math.tau/20,(j+1)*math.tau/20
  rod('Seat pull loop',(.055*math.cos(a),1.035+.031*math.sin(a),2.885),(.055*math.cos(b),1.035+.031*math.sin(b),2.885),.006,'SafetyYellow' if j%3 else 'Black',n=5)
 for y,r in [(.855,.075),(.876,.065),(.895,.055),(.913,.043)]:
  ellipsoid('Stick boot',(0,y,3.088),(r,.023,r*.9),'Rubber',n=12,k=4)
 fighter_tube('Control column',[(0,.91,3.088),(0,.99,3.102),(.006,1.062,3.088),(.01,1.084,3.066)],.016,'SteelDark',8)
 fighter_shell('Grip',[[ (x+rx*math.cos(a*math.tau/12),y,z+rz*math.sin(a*math.tau/12)) for a in range(12)]
   for x,y,z,rx,rz in [(0,1.018,3.09,.022,.027),(.009,1.035,3.082,.029,.025),(.009,1.070,3.062,.021,.021),(.009,1.108,3.055,.032,.027),(0,1.143,3.060,.040,.030),(-.005,1.156,3.062,.030,.023)]],'Black')
 ellipsoid('Stick thumb rest',(.034,1.106,3.056),(.023,.011,.021),'Black',n=12,k=4)
 ellipsoid('Index trigger',(-.006,1.112,3.086),(.019,.024,.012),'Graphite',n=12,k=4)
 for x,y in [(-.019,1.146),(.013,1.125)]:
  rod('Trim hat',(x,y,3.038),(x,y+.003,3.028),.009,'Graphite',n=10)
  rod('Hat vertical index',(x,y-.002,3.027),(x,y+.006,3.027),.0009,'SteelGrey',n=4)
  rod('Hat index',(x-.004,y+.002,3.027),(x+.004,y+.002,3.027),.0009,'SteelGrey',n=4)


def fighter_hinge_axes():
 # Aviation.syncModels rotates about node-local axes. Orient the two fin
 # hinges along their cant, and fold the main wheels inboard into the belly.
 for name,axis,angle in [('RudderR','Y',math.radians(20)),('RudderL','Y',math.radians(-20)),
                         ('GearLeft','Z',math.pi),('GearRight','Z',math.pi)]:
  joint=bpy.data.objects[name]
  joint.rotation_euler.rotate_axis(axis,angle)
  inverse=joint.rotation_euler.to_matrix().inverted().to_4x4()
  for child in joint.children:
   child.data.transform(inverse)


def build_objects():
 parents={}
 for name,point in PIVOTS.items():
  e=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(e);e.location=cv(point);parents[name]=e;OBJECTS.append(e)
 for (group,m),(vertices,faces) in BATCH.items():
  origin=PIVOTS.get(group,(0,0,0));data=bpy.data.meshes.new(group+'_'+m);data.from_pydata([cv(tuple(v[i]-origin[i]for i in range(3)))for v in vertices],[],faces);data.materials.append(MATS[m]);data.update();bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free()
  obj=bpy.data.objects.new(group+'_'+m,data);bpy.context.collection.objects.link(obj)
  if group in parents:obj.parent=parents[group]
  OBJECTS.append(obj)
  # Auto-smooth only small adjacent faces; surfaces retain their deliberate hard edges.
  for poly in data.polygons:poly.use_smooth=True
  bpy.context.view_layer.objects.active=obj
  split=obj.modifiers.new('Manufactured edge normals','EDGE_SPLIT');split.split_angle=math.radians(32);split.use_edge_angle=True;bpy.ops.object.modifier_apply(modifier=split.name)
 return parents

def camera_at(point,target,ortho):
 bpy.ops.object.camera_add(location=cv(point));cam=bpy.context.object;cam.rotation_euler=(Vector(cv(target))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=ortho;bpy.context.scene.camera=cam

def stage(kind):
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=1440;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
 scene.world=bpy.data.worlds.new('Aviation studio world');scene.world.color=(.18,.22,.27);scene.view_settings.view_transform='AgX'
 bpy.ops.object.light_add(type='AREA',location=cv((-130,230,40)if kind=='carrier'else(-15,24,8)));light=bpy.context.object;light.data.energy=3500000 if kind=='carrier'else 16000;light.data.shape='DISK';light.data.size=200 if kind=='carrier'else 20;light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.light_add(type='SUN',location=(0,0,100));bpy.context.object.data.energy=2;bpy.context.object.rotation_euler=(.4,-.3,-.6)
 if kind=='carrier':
  # Render at rest waterline. Model geometry remains below water in the .blend.
  bpy.ops.mesh.primitive_plane_add(size=2000,location=(0,0,-.05));water=bpy.context.object;water.name='Preview sea';m=bpy.data.materials.new('PreviewOcean');m.diffuse_color=(.025,.085,.105,1);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.025,.085,.105,1);bs.inputs['Metallic'].default_value=.45;bs.inputs['Roughness'].default_value=.26;water.data.materials.append(m);camera_at((-240,215,290),(0,8,0),440)
 else:
  bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-2.04));floor=bpy.context.object;floor.name='Preview studio';floor.data.materials.append(MATS['DeckNonslip']);camera_at((-18,9,21),(0,.34,.55),22.2)
  bpy.ops.object.light_add(type='AREA',location=cv((10,6,-14)))
  fill=bpy.context.object
  fill.data.energy=5400
  fill.data.shape='DISK'
  fill.data.size=14
  fill.rotation_euler=(-fill.location).to_track_quat('-Z','Y').to_euler()
  bpy.data.lights['Sun'].energy=.72
  bpy.data.lights['Sun'].angle=math.radians(16)
 scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ASSETS/(kind+'-preview.png'))

def main(kind):
 global BATCH,PIVOTS,MATS,OBJECTS
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0;BATCH={};PIVOTS={};MATS={};OBJECTS=[];paint();carrier()if kind=='carrier'else fighter();carrier_detail()if kind=='carrier'else fighter_detail();build_objects()
 if kind=='fighter':fighter_hinge_axes()
 bpy.ops.object.select_all(action='DESELECT')
 for o in OBJECTS:o.select_set(True)
 bpy.context.view_layer.objects.active=next(o for o in OBJECTS if o.type=='MESH')
 bpy.ops.export_scene.gltf(filepath=str(PUB/(kind+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_cameras=False,export_lights=False,export_animations=False,export_materials='EXPORT',export_extras=True)
 tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons)for o in OBJECTS if o.type=='MESH');verts=sum(len(o.data.vertices)for o in OBJECTS if o.type=='MESH');stats={'asset':kind,'metres':True,'axes':'+Y up, +Z forward, +X right','triangles':tris,'vertices':verts,'meshes':sum(o.type=='MESH'for o in OBJECTS),'pivots':PIVOTS,'glbBytes':(PUB/(kind+'.glb')).stat().st_size,'generator':'tools/aviation/build.py','blender':bpy.app.version_string};(PUB/(kind+'.json')).write_text(json.dumps(stats,indent=2));print('AVIATION_MODEL',json.dumps(stats),flush=True)
 stage(kind);bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/(kind+'.blend')))
 if not args.no_render:bpy.ops.render.render(write_still=True)
for kind in (['carrier','fighter']if args.asset=='all'else[args.asset]):
 main(kind)
 if kind=='carrier':subprocess.run(['node',str(ROOT/'tools/distribution-assets.mjs'),'pack','carrier'],check=True)
