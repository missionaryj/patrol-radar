/** One everyday sentence for a detection card. No grades or scores. */
export function reliabilityLine(d: { radio?: string; category?: string; vendor?: string }): string {
  if (d.radio === 'wifi') {
    if (d.category === 'fixed') return 'This is a fixed camera, not an officer nearby.';
    if (d.vendor === 'Axon') return 'This looks like Axon gear over Wi-Fi, and it can still be a dock or a camera that is off.';
    return 'Routers like this are common on buses and other vehicles, so this often is not police.';
  }
  switch (d.category) {
    case 'body-camera': return 'This looks like a police body camera, and it can still be wrong.';
    case 'cew': return 'This looks like Axon gear, and it can still be something else.';
    case 'radio': return 'Radios like this are also used outside police work.';
    case 'fixed': return 'This is a fixed camera or sensor, not an officer nearby.';
    case 'vehicle': return 'This looks like in-car gear, and it can still be something else.';
    default: return 'This is a possible match, not proof that police are here.';
  }
}

export const GROUPED_RELIABILITY = 'Nearby signals can be one patrol car, or unrelated gear in the same place.';
