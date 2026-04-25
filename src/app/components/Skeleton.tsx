export function TreeSkeleton() {
  return (
    <div className="temporal-tree" style={{ paddingLeft: "2rem" }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="skeleton skeleton-node" />
      ))}
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div className="glass-card" style={{ padding: "1.5rem" }}>
      <div className="skeleton" style={{ aspectRatio: "1", marginBottom: "1rem", borderRadius: "12px" }} />
      <div className="skeleton skeleton-text" style={{ width: "70%" }} />
      <div className="skeleton skeleton-text" style={{ width: "40%" }} />
      <div className="skeleton skeleton-text" style={{ width: "90%", marginTop: "1rem" }} />
      <div className="skeleton skeleton-text" />
      <div className="skeleton skeleton-text" style={{ width: "60%" }} />
    </div>
  )
}
