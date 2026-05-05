import { useEffect, useRef } from "react"
import p5 from "p5"

export function OrdinalBackground() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const sketch = (p: p5) => {
      const particles: Particle[] = []
      let accentColor: p5.Color
      const particleCount = Math.min(window.innerWidth / 20, 80)
      const connectionDistance = 180

      class Particle {
        pos: p5.Vector
        vel: p5.Vector
        size: number
        alpha: number

        constructor() {
          this.pos = p.createVector(p.random(p.width), p.random(p.height))
          this.vel = p.createVector(p.random(-0.5, 0.5), p.random(-0.5, 0.5))
          this.size = p.random(1.5, 4)
          this.alpha = p.random(120, 220)
        }

        update() {
          this.pos.add(this.vel)

          if (this.pos.x < 0) this.pos.x = p.width
          if (this.pos.x > p.width) this.pos.x = 0
          if (this.pos.y < 0) this.pos.y = p.height
          if (this.pos.y > p.height) this.pos.y = 0

          const mouseDist = p.dist(p.mouseX, p.mouseY, this.pos.x, this.pos.y)
          if (mouseDist < 100) {
            const push = p.createVector(this.pos.x - p.mouseX, this.pos.y - p.mouseY)
            push.normalize()
            push.mult(0.5)
            this.pos.add(push)
          }
        }

        draw() {
          p.noStroke()
          // Using a default color if accentColor isn't set yet, 
          // though it should be after setup()
          const c = accentColor || p.color(247, 147, 26)
          p.fill(
            p.red(c),
            p.green(c),
            p.blue(c),
            this.alpha
          )
          p.circle(this.pos.x, this.pos.y, this.size)
        }
      }

      p.setup = () => {
        const canvas = p.createCanvas(window.innerWidth, window.innerHeight)
        canvas.parent(containerRef.current!)
        accentColor = p.color(247, 147, 26)
        
        for (let i = 0; i < particleCount; i++) {
          particles.push(new Particle())
        }
      }

      p.draw = () => {
        p.clear(0, 0, 0, 0)
        
        for (let i = 0; i < particles.length; i++) {
          particles[i].update()
          particles[i].draw()

          for (let j = i + 1; j < particles.length; j++) {
            const d = p.dist(
              particles[i].pos.x,
              particles[i].pos.y,
              particles[j].pos.x,
              particles[j].pos.y
            )

            if (d < connectionDistance) {
              const opacity = p.map(d, 0, connectionDistance, 180, 0)
              p.stroke(247, 147, 26, opacity * 0.8)
              p.strokeWeight(1)
              p.line(
                particles[i].pos.x,
                particles[i].pos.y,
                particles[j].pos.x,
                particles[j].pos.y
              )
            }
          }
        }
      }

      p.windowResized = () => {
        p.resizeCanvas(window.innerWidth, window.innerHeight)
      }
    }

    const p5Instance = new p5(sketch)

    return () => {
      p5Instance.remove()
    }
  }, [])

  return (
    <div 
      ref={containerRef} 
      className="ordinal-p5-container"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        opacity: 0.9
      }}
    />
  )
}
