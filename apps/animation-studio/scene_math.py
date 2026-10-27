"""Deterministic geometry math shared by the renderer and ordinary unit tests."""
import bisect
import math

def lerp(a,b,u):return [x+(y-x)*u for x,y in zip(a,b)]
def distance(a,b):return math.sqrt(sum((x-y)**2 for x,y in zip(a,b)))
def smooth(u):return u*u*(3-2*u)

def spline(points,resolution=12,closed=False):
    if len(points)==2 and not closed:return [lerp(points[0],points[1],i/resolution) for i in range(resolution+1)]
    result=[];count=len(points);segments=count if closed else count-1
    def get(i):return points[i%count] if closed else points[max(0,min(count-1,i))]
    for index in range(segments):
        a,b,c,d=[get(index+j) for j in (-1,0,1,2)]
        for k in range(resolution):
            t=k/resolution;t2=t*t;t3=t2*t
            result.append([.5*((2*b[j])+(-a[j]+c[j])*t+(2*a[j]-5*b[j]+4*c[j]-d[j])*t2+(-a[j]+3*b[j]-3*c[j]+d[j])*t3) for j in range(3)])
    result.append(list(points[0] if closed else points[-1]));return result

class PathSampler:
    def __init__(self,points,resolution=16,closed=False):
        self.points=spline(points,resolution,closed);self.lengths=[0.]
        for a,b in zip(self.points,self.points[1:]):self.lengths.append(self.lengths[-1]+distance(a,b))
        self.length=self.lengths[-1]
        if self.length<1e-8:raise ValueError('Path has zero length')
    def at(self,u):
        value=max(0,min(1,u))*self.length
        index=max(0,min(len(self.points)-2,bisect.bisect_right(self.lengths,value)-1))
        a,b=self.points[index:index+2];length=self.lengths[index+1]-self.lengths[index]
        return lerp(a,b,(value-self.lengths[index])/max(length,1e-8)),[y-x for x,y in zip(a,b)]

def noise(x,y,seed=0):
    def value(a,b):
        n=(a*374761393+b*668265263+seed*1442695041)&0xffffffff
        n=((n^(n>>13))*1274126177)&0xffffffff
        return ((n^(n>>16))&0xffffffff)/4294967295
    ix=math.floor(x);iy=math.floor(y);u=smooth(x-ix);v=smooth(y-iy)
    a=value(ix,iy)*(1-u)+value(ix+1,iy)*u;b=value(ix,iy+1)*(1-u)+value(ix+1,iy+1)*u
    return a*(1-v)+b*v

def terrain_height(x,y,spec):
    width,length,height=spec['size'];octaves=spec.get('octaves',4);amplitude=1;frequency=spec.get('noise_scale',3);total=0;weight=0
    for i in range(octaves):
        n=noise((x/width+.5)*frequency,(y/length+.5)*frequency,spec.get('seed',0)+i*17)
        if spec.get('ridge',True):n=(1-abs(2*n-1))**2
        total+=n*amplitude;weight+=amplitude;amplitude*=spec.get('roughness',.55);frequency*=2
    z=spec.get('base_height',0)+height*total/max(weight,1e-8)
    for peak in spec.get('peaks',[]):
        dx=x-peak['center'][0];dy=y-peak['center'][1];z+=peak['height']*math.exp(-(dx*dx+dy*dy)/(2*peak['width']**2))
    for flat in spec.get('flatten',[]):
        r=math.hypot(x-flat['center'][0],y-flat['center'][1])/flat['radius']
        blend=1-smooth(max(0,min(1,(r-.65)/.35)))
        z=z*(1-blend)+flat.get('height',0)*blend
    return z

def ribbon_mesh(points,width):
    vertices=[];faces=[]
    for i,p in enumerate(points):
        a=points[max(0,i-1)];b=points[min(len(points)-1,i+1)];dx=b[0]-a[0];dy=b[1]-a[1];norm=max(math.hypot(dx,dy),1e-8)
        side=(-dy/norm*width/2,dx/norm*width/2)
        vertices.extend([(p[0]+side[0],p[1]+side[1],p[2]),(p[0]-side[0],p[1]-side[1],p[2])])
        if i:faces.append((2*i-2,2*i-1,2*i+1,2*i))
    return vertices,faces

def lathe_mesh(profile,segments=64,caps=True):
    vertices=[(radius*math.cos(i/segments*math.tau),radius*math.sin(i/segments*math.tau),z) for radius,z in profile for i in range(segments)]
    faces=[]
    for j in range(len(profile)-1):
        for i in range(segments):faces.append((j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i))
    if caps:faces.extend([tuple(reversed(range(segments))),tuple((len(profile)-1)*segments+i for i in range(segments))])
    return vertices,faces
