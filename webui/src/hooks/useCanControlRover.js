import { useSessionSelector } from '../context/SessionContext.jsx';

export function selectCanControlRover(state, roverId) {
  return Boolean(state.session?.roster?.find((rover) => String(rover.id) === String(roverId))?.permissions?.canControl);
}

export default function useCanControlRover(roverId) {
  return useSessionSelector((state) => selectCanControlRover(state, roverId));
}
