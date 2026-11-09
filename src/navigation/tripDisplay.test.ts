import {describe,it,expect} from 'vitest';
import {speedMph,routeRemaining,remainingSeconds,distanceToNextTurn} from './tripDisplay';
import type {PreviewRoute} from './mapboxPreview';
const route:PreviewRoute={distanceMeters:222, durationSeconds:80,geometry:[[0,0],[0.001,0],[0.002,0]],steps:[],congestion:[]};
describe('driving dashboard metrics',()=>{
 it('never invents speed when GPS does not provide it',()=>{expect(speedMph(null)).toBe('—');expect(speedMph(-1)).toBe('—');expect(speedMph(10)).toBe('22')});
 it('projects travel onto route rather than direct distance',()=>{expect(routeRemaining(route,{lat:0,lng:0})).toBeCloseTo(222,0);expect(routeRemaining(route,{lat:0,lng:0.001})).toBeCloseTo(111,0);expect(routeRemaining(route,{lat:0,lng:0.002})).toBeCloseTo(0,0)});
 it('calculates approximate time left',()=>expect(remainingSeconds(route,111)).toBe(40));
 it('formats approaching turns',()=>expect(distanceToNextTurn(65)).toBe('70 m'));
});
