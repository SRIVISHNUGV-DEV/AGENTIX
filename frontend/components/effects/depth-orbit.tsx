interface DepthOrbitProps {
  className?: string
  compact?: boolean
}

export function DepthOrbit({ className = '', compact = false }: DepthOrbitProps) {
  return (
    <div
      className={`depth-orbit ${compact ? 'depth-orbit--compact' : ''} ${className}`.trim()}
      aria-hidden="true"
    >
      <div className="depth-orbit__halo depth-orbit__halo--outer" />
      <div className="depth-orbit__halo depth-orbit__halo--mid" />
      <div className="depth-orbit__halo depth-orbit__halo--inner" />

      <div className="depth-orbit__plane">
        <div className="depth-orbit__disc depth-orbit__disc--main" />
        <div className="depth-orbit__disc depth-orbit__disc--ghost" />
        <div className="depth-orbit__disc depth-orbit__disc--ring" />
      </div>

      <div className="depth-orbit__column depth-orbit__column--left" />
      <div className="depth-orbit__column depth-orbit__column--right" />

      <div className="depth-orbit__spark depth-orbit__spark--a" />
      <div className="depth-orbit__spark depth-orbit__spark--b" />
      <div className="depth-orbit__spark depth-orbit__spark--c" />
    </div>
  )
}
