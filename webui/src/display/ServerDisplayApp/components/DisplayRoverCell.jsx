// Display Rover Cell
// Purpose: Shows one rover's room-readable driver and battery status.
// Scope: Reuses shared rover/battery presentation primitives while avoiding controls, queues, and video.
import { useVisualTelemetrySelector } from '../../../context/TelemetryContext.jsx';
import { batteryTelemetryEqual, selectBatteryTelemetry } from '../../../context/telemetryViews.js';
import BatteryBar from '../../../components/BatteryBar/index.jsx';
import RoverLabel from '../../../components/RoverLabel/index.jsx';
import AutoFitText from '../../../mini/MiniSummaryApp/components/AutoFitText.jsx';
import {
  buildRoverStateText,
  findDriverForRover,
  formatBatteryText,
  getDisplayBatteryVisual,
} from '../utils.js';

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

export default function DisplayRoverCell({ rover, session }) {
  const batteryTelemetry = useVisualTelemetrySelector(rover?.id, selectBatteryTelemetry, batteryTelemetryEqual);
  const frame = { sensors: batteryTelemetry };
  const visual = getDisplayBatteryVisual({ rover, frame });
  const driver = findDriverForRover({ roverId: rover?.id, session });
  const stateText = buildRoverStateText(rover, visual);
  const batteryText = formatBatteryText(visual);
  const active = Boolean(driver);
  const urgent = Boolean(visual?.urgentActive);
  const warn = Boolean(visual?.warnActive);
  const locked = Boolean(rover?.locked);

  return (
    <article
      className={classNames(
        'relative min-h-0 overflow-hidden border border-slate-800 bg-black',
        locked ? 'border-red-400 ring-4 ring-red-500/80' : '',
        !locked && active ? 'ring-2 ring-sky-400/80' : '',
        !locked && urgent ? 'ring-4 ring-red-500/90' : !locked && warn ? 'ring-2 ring-amber-300/80' : '',
      )}
    >
      <BatteryBar visual={visual} variant="background" orientation="vertical" />
      <div className="relative z-10 grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-[0.55vh] p-[0.85vw] text-center">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-[0.8vw]">
          <div className="min-w-0">
            <RoverLabel
              rover={rover}
              fallback={rover?.id}
              as={AutoFitText}
              className="leading-none"
              maxSize={108}
              minSize={26}
            />
          </div>
          {locked ? (
            // Keep the lock warning adjacent to the rover identity so the cell
            // remains readable while still making the locked state impossible
            // to miss at a glance.
            <div className="max-w-[40vw] border-4 border-red-100 bg-red-700 px-[1vw] py-[0.55vh] text-center text-[clamp(2rem,5vh,5.2rem)] font-black leading-none text-white">
              <div>LOCKED</div>
              {rover?.lockReason ? (
                <div className="mt-[0.35vh] text-[clamp(1.2rem,2.9vh,3rem)] leading-none text-red-50">
                  {rover.lockReason}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1.45fr)_minmax(0,0.85fr)] items-center gap-[1vw]">
          <div className="min-w-0">
            <AutoFitText
              className={classNames(
                'font-black leading-none',
                active ? 'text-white' : 'text-slate-400',
              )}
              maxSize={172}
              minSize={38}
            >
              {driver?.label || 'Idle'}
            </AutoFitText>
          </div>
          <div className="min-w-0">
            <AutoFitText
              className={classNames(
                'font-black leading-none',
                urgent ? 'text-red-100' : warn ? 'text-amber-100' : 'text-slate-100',
              )}
              maxSize={136}
              minSize={32}
            >
              {batteryText}
            </AutoFitText>
          </div>
        </div>
        {stateText ? (
          <div className="min-w-0 text-[clamp(1.25rem,2.5vh,2.6rem)] font-black leading-none text-amber-100">
            {stateText}
          </div>
        ) : (
          // This empty line keeps cells with and without exceptional states the
          // same height. The grid should not jump just because one rover becomes
          // locked or low battery while people are reading the board.
          <div aria-hidden="true" />
        )}
      </div>
    </article>
  );
}
