import TopDownMap from '../../TopDownMap/index.jsx';

export default function HudMapOverlay({
  roverId = null,
  sensors,
  show = true,
  mapPosition = 'top-center',
  layoutFormat = 'desktop',
  mobileHud = false,
}) {
  if (!show) return null;
  const portraitMobile = layoutFormat === 'mobile-portrait';
  const mapSize = '240px';
  const mapScale = portraitMobile ? 0.3 : mobileHud ? 0.33 : 0.7;
  const mapOpacity = mobileHud ? 0.6 : 0.7;
  const mapStyle = {
    width: mapSize,
    height: mapSize,
    opacity: mapOpacity,
    transform: mapPosition === 'top-center' ? `translateX(-50%) scale(${mapScale})` : `scale(${mapScale})`,
    transformOrigin:
      mapPosition === 'bottom-left'
        ? 'bottom left'
        : mapPosition === 'top-center'
        ? 'top center'
        : 'top right',
    ...(mapPosition === 'bottom-left'
      ? { left: '0.25rem', bottom: '0.25rem' }
      : mapPosition === 'top-center'
      ? { left: '50%', top: '0.25rem' }
      : { right: '0.25rem', top: '0.25rem' }),
  };

  return (
    <div className="pointer-events-none absolute rounded" style={mapStyle}>
      <TopDownMap roverId={roverId} sensors={sensors} size={240} overlay />
    </div>
  );
}
