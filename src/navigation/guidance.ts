import type { Coordinate, PreviewRoute } from './mapboxPreview';
export function metres(a: Coordinate, b: Coordinate): number {
 const rad = Math.PI / 180, dlat=(b.lat-a.lat)*rad,dlng=(b.lng-a.lng)*rad;
 const h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlng/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export class Guidance {
 private index=0; private announced=-1; private offSince=0;
 constructor(readonly route: PreviewRoute, readonly destination: Coordinate) {}
 update(fix: Coordinate, accuracy: number, now: number) {
   const steps=this.route.steps;
   while(this.index < steps.length-1 && metres(fix,{lng:steps[this.index].location[0],lat:steps[this.index].location[1]}) < 25) this.index++;
   const step=steps[this.index];
   const distance=step ? metres(fix,{lng:step.location[0],lat:step.location[1]}) : metres(fix,this.destination);
   const valid=Number.isFinite(accuracy) && accuracy<=60;
   const routeNear=this.route.geometry.reduce((min,[lng,lat])=>Math.min(min,metres(fix,{lat,lng})),Infinity);
   // Large GPS drift should never trigger rerouting. Require 15 s of reliable off-route fixes.
   if(valid && routeNear>Math.max(80,accuracy*2)) { if(!this.offSince)this.offSince=now; }
   else this.offSince=0;
   const reroute=!!this.offSince && now-this.offSince>15000;
   const arrival=valid && metres(fix,this.destination)<35;
   const announce=valid && step && distance<180 && this.announced!==this.index && !arrival ? step.instruction : undefined;
   if(announce)this.announced=this.index;
   return {instruction:step?.instruction??'Continue to destination', metresToTurn:distance, arrived:arrival, reroute, announce, nextIndex:this.index};
 }
}
