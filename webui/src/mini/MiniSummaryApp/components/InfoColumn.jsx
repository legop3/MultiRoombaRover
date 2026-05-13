// Info Column
// Purpose: Defines the Info Column module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import RoverMediaPlayer from '../../../components/RoverMediaPlayer/index.jsx';
import BatteryBar from '../../../components/BatteryBar/index.jsx';
import { roverNameChromeStyle } from '../../../lib/roverColor.js';
import { getBatteryVisual } from '../utils.js';
import AutoFitText from './AutoFitText.jsx';

export default function InfoColumn({
  rover,
  frame,
  driverLabel,
  sessionInfo,
  videoMode = 'snapshot',
  snapshotFeed,
  withDivider = false,
  showPreview = true,
  variant = 'stacked',
}) {
  const batteryVisual = getBatteryVisual({ rover, frame });
  const batteryPercent = batteryVisual?.available ? batteryVisual.percentDisplay : null;
  const isActiveView = variant === 'active';
  return (
    <div
      className={`relative flex min-w-0 flex-1 flex-col gap-4 overflow-hidden bg-black px-0 py-0 ${
        withDivider ? 'border-r border-slate-700/60' : ''
      }`}
    >
      <BatteryBar
        visual={batteryVisual}
        orientation={isActiveView ? 'vertical' : 'horizontal'}
        variant="background"
      />
      {isActiveView ? (
        <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-between text-center">
          <div className="min-w-0 bg-transparent px-0 py-0 leading-none">
            <AutoFitText
              className="font-semibold leading-none text-white rounded border border-transparent px-1 py-[1px]"
              maxSize={1000}
              minSize={18}
              style={roverNameChromeStyle(rover.color, 0.18)}
            >
              {rover.name || rover.id}
            </AutoFitText>
          </div>
          {driverLabel ? (
            <div className="min-w-0 bg-transparent px-0 py-0 leading-none">
              <AutoFitText className="font-semibold leading-none text-white" maxSize={1000} minSize={16}>
                {driverLabel}
              </AutoFitText>
            </div>
          ) : (
            <div />
          )}
          <div className="relative min-w-0 overflow-hidden bg-transparent px-0 py-0 leading-none">
            <div className="relative">
              <AutoFitText className="font-semibold leading-none text-white" maxSize={1000} minSize={16}>
                {batteryPercent == null ? '--%' : `${batteryPercent}%`}
              </AutoFitText>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="relative z-10 flex min-w-0 flex-col gap-1 text-center">
            <div className="min-w-0 bg-transparent px-0 py-0 leading-none">
              <AutoFitText
                className="font-semibold leading-none text-white rounded border border-transparent px-1 py-[1px]"
                maxSize={1000}
                minSize={18}
                style={roverNameChromeStyle(rover.color, 0.18)}
              >
                {rover.name || rover.id}
              </AutoFitText>
            </div>
            {driverLabel ? (
              <div className="min-w-0 bg-transparent px-0 py-0 leading-none">
                <AutoFitText className="font-semibold leading-none text-white" maxSize={1000} minSize={16}>
                  {driverLabel}
                </AutoFitText>
              </div>
            ) : null}
            <div className="relative min-w-0 overflow-hidden bg-transparent px-0 py-0 leading-none">
              <div className="relative">
                <AutoFitText className="font-semibold leading-none text-white" maxSize={80} minSize={16}>
                  {batteryPercent == null ? '--%' : `${batteryPercent}%`}
                </AutoFitText>
              </div>
            </div>
          </div>

          <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex w-full min-w-0 flex-1 flex-col items-center gap-4">
              {showPreview ? (
                <div className="mt-auto w-full">
                  <div className="w-full aspect-[4/3]">
                    <RoverMediaPlayer
                      sessionInfo={sessionInfo}
                      videoMode={videoMode}
                      snapshotFeed={snapshotFeed}
                      audioSessionInfo={null}
                      label={rover.name || rover.id}
                      sensors={frame?.sensors || null}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
