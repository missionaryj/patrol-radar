// Synthetic Champaign-Urbana style dispatch transcripts. Units, names and plates are invented.
export const CHAMPAIGN_FIXTURES = [
  { text: 'Patrol 1, unit 2L14, respond to Green and Wright for a 10-50, two vehicles, no injuries reported', expect: { callType: 'traffic accident', location: 'green & wright', status: 'dispatched' } },
  { text: '2L14 10-97 at Green and Wright', expect: { location: 'green & wright', status: 'onscene' } },
  { text: 'Car 31 copy a suspicious person at Neil and Kirby, subject named Jacob Ortiz, plate Illinois ABC 1234', expect: { callType: 'suspicious person', location: 'neil & kirby', status: 'dispatched' } },
  { text: 'Officer Thompson en route to 1200 West Bradley Avenue, alarm call', expect: { callType: 'alarm', location: '1200 west bradley avenue', status: 'enroute' } },
  { text: 'Respond to Prospect and Springfield for a crash, driver is Maria Lopez, phone 217-555-0142', expect: { callType: 'crash', location: 'prospect & springfield', status: 'dispatched' } },
  { text: 'Deputy 7 copy a welfare check at Philo and Windsor', expect: { callType: 'welfare check', location: 'philo & windsor', status: 'dispatched' } },
  { text: 'UI 3U22 on scene at Lincoln and Florida', expect: { location: 'lincoln & florida', status: 'onscene' } },
  { text: 'Dispatched to 505 East Green Street, theft from a vehicle, registration 829 4471', expect: { callType: 'theft', location: '505 east green street', status: 'dispatched' } },
  { text: 'Sgt. Miller clear, back in service', expect: { status: 'clear' } },
  { text: 'static ... copy', expect: null },
] as const;
export const CHAMPAIGN_MOCK_FEED: string[] = CHAMPAIGN_FIXTURES.map(f => f.text as string).concat([
  'Respond to Main and Race for a domestic disturbance',
  'Medic 4 and Engine 161 respond to Mattis and Kirby, medical',
  'On scene at Main and Race',
  'Copy a burglary at Cunningham and University',
]);
