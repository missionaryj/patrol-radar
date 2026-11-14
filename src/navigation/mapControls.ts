export type NavigationMap = {
  recenter(): boolean;
  set3D(enabled: boolean): Promise<void>;
};

type MapButton = Pick<HTMLButtonElement, 'onclick' | 'setAttribute' | 'textContent'>;

export function wireNavigationMapControls(
  recenterButton: MapButton,
  threeDButton: MapButton,
  map: NavigationMap,
  initial3D: boolean,
  on3DChange: (enabled: boolean) => void = () => {}
) {
  let enabled = initial3D;
  const render = () => {
    threeDButton.textContent = enabled ? '2D' : '3D';
    threeDButton.setAttribute('aria-label', enabled ? 'Switch to 2D view' : 'Switch to 3D view');
    threeDButton.setAttribute('aria-pressed', String(enabled));
    threeDButton.setAttribute('title', enabled ? 'Switch to 2D view' : 'Switch to 3D view');
  };
  recenterButton.onclick = () => { map.recenter(); };
  threeDButton.onclick = () => {
    enabled = !enabled;
    render();
    on3DChange(enabled);
    void map.set3D(enabled);
  };
  render();
}
