export function LogoIcon({ className, size = 44 }: { className?: string; size?: number }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 240 240" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#F7931A", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "#FFAB40", stopOpacity: 1 }} />
        </linearGradient>
      </defs>

      {/* Unified Trace: Ordinal (Arc) + Mind (Folds) */}
      <path 
        d="M 50,150 
           A 80,80 0 1,1 190,150 
           C 190,120 170,100 155,100 
           C 140,100 135,125 120,125 
           C 105,125 100,100 85,100 
           C 70,100 50,120 50,150 
           Z" 
        stroke="url(#flowGradient)" 
        strokeWidth="12" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        fill="none"
      />

      {/* Inscription Point: Represents the ID or Taproot Address (The beginning of everything) */}
      <circle cx="120" cy="165" r="6" fill="#F7931A">
        <animate attributeName="opacity" values="1;0.4;1" dur="3s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}
