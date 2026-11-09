import type { Coordinate, PreviewRoute } from './mapboxPreview';

export function speedMph(speed: number | null | undefined): string {
  return speed == null || !Number.isFinite(speed) || speed < 0 ? '—' : String(Math.round(speed * 2.2369362921));
}
/** Distance to the destination along the route, using the closest projected polyline segment. */
export function routeRemaining(route: PreviewRoute, fix: Coordinate): number {
  const shape=route.geometry;
  if(shape.length<2) return route.distanceMeters;
  const kLat=111195,kLng=kLat*Math.cos(fix.lat*Math.PI/180);
  let total=0,best=Infinity,at=0;
  for(let i=1;i<shape.length;i++){
    const a=shape[i-1],b=shape[i];
    const dx=(b[0]-a[0])*kLng,dy=(b[1]-a[1])*kLat;
    const seg=Math.hypot(dx,dy);
    const ux=(fix.lng-a[0])*kLng,uy=(fix.lat-a[1])*kLat;
    const fraction=seg>0?Math.max(0,Math.min(1,(ux*dx+uy*dy)/(seg*seg))):0;
    const gap=Math.hypot(ux-fraction*dx,uy-fraction*dy);
    if(gap<best){best=gap;at=total+seg*fraction;}
    total+=seg;
  }
  const scaled=total>0?route.distanceMeters*Math.max(0,Math.min(1,(total-at)/total)):route.distanceMeters;
  return Math.max(0,scaled);
}
export function remainingSeconds(route: PreviewRoute, metresLeft: number): number {
  if (!route.distanceMeters || !Number.isFinite(metresLeft)) return route.durationSeconds;
  return Math.max(0,route.durationSeconds*Math.min(1,Math.max(0,metresLeft/route.distanceMeters)));
}
export function arrivalTime(seconds: number, now = Date.now()): string {
  if(!Number.isFinite(seconds)) return '—';
  return new Date(now+Math.max(0,seconds)*1000).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}
export function distanceToNextTurn(meters: number): string {
  if(!Number.isFinite(meters)) return '—';
  return meters<500?Math.max(0,Math.round(meters/10)*10)+' m':(meters/1609.344).toFixed(1)+' mi';
}
