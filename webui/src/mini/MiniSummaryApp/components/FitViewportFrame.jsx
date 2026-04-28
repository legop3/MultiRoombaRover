// 4:3 viewport fitting frame for active mini-summary video.
export default function FitViewportFrame({ children }) {
  return (
    <div className="flex h-full w-full items-center justify-start overflow-hidden bg-black">
      <div
        className="relative flex items-center justify-center overflow-hidden bg-black"
        style={{
          width: 'min(100%, calc(100vh * 4 / 3))',
          height: 'min(100%, calc(100vw * 3 / 4))',
          maxWidth: '100%',
          maxHeight: '100%',
          aspectRatio: '4 / 3',
        }}
      >
        <div className="flex h-full w-full items-center justify-center overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
