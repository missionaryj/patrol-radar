// Synthetic transcripts (no real people/units).
export const FIXTURES = [
  { text: 'Unit 2A12 respond to 1200 North Clark Street for a 10-50, two vehicles', expect: { callType: 'traffic accident', location: '1200 north clark street', status: 'dispatched' } },
  { text: '2A12 10-97 at 1200 North Clark Street', expect: { status: 'onscene', location: '1200 north clark street' } },
  { text: 'Officer Johnson badge 4471 copy a domestic disturbance at State and Madison', expect: { callType: 'domestic disturbance', location: 'state & madison', status: 'dispatched' } },
  { text: 'Car 14 en route to 55 West Monroe Street, alarm call', expect: { callType: 'alarm', status: 'enroute', location: '55 west monroe street' } },
  { text: 'Sgt. Miller clear, back in service', expect: { status: 'clear' } },
  { text: 'uh ... static ... copy', expect: null },
] as const;
export const MOCK_FEED: string[] = FIXTURES.map((f): string => f.text).filter(t => !t.startsWith('uh')).concat([
  'Dispatched to 300 South Wacker Drive, medical call',
  'Respond to Lake and Wells for a crash',
  'On scene at Lake and Wells',
]);
