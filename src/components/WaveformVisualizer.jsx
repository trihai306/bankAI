import { useEffect, useRef } from 'react'

export default function WaveformVisualizer({ isActive = false, color = 'violet' }) {
    const canvasRef = useRef(null)
    const animationRef = useRef(null)
    const barsRef = useRef([])

    const colorMap = {
        violet: { primary: '#8b5cf6', secondary: '#a78bfa', glow: 'rgba(139, 92, 246, 0.3)' },
        emerald: { primary: '#34d399', secondary: '#6ee7b7', glow: 'rgba(52, 211, 153, 0.3)' },
        cyan: { primary: '#22d3ee', secondary: '#67e8f9', glow: 'rgba(34, 211, 238, 0.3)' }
    }

    const colors = colorMap[color] || colorMap.violet

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        const dpr = window.devicePixelRatio || 1

        // Set canvas size
        const rect = canvas.getBoundingClientRect()
        canvas.width = rect.width * dpr
        canvas.height = rect.height * dpr
        ctx.scale(dpr, dpr)

        const barCount = 50
        const barWidth = (rect.width / barCount) * 0.7
        const barGap = (rect.width / barCount) * 0.3

        // Initialize bars with random heights
        if (barsRef.current.length === 0) {
            barsRef.current = Array.from({ length: barCount }, () => ({
                height: Math.random() * 0.3 + 0.1,
                targetHeight: Math.random() * 0.3 + 0.1,
                velocity: 0
            }))
        }

        const animate = () => {
            ctx.clearRect(0, 0, rect.width, rect.height)

            barsRef.current.forEach((bar, i) => {
                // Update target height periodically
                if (isActive && Math.random() < 0.05) {
                    bar.targetHeight = Math.random() * 0.8 + 0.2
                } else if (!isActive && Math.random() < 0.02) {
                    bar.targetHeight = Math.random() * 0.3 + 0.1
                }

                // Smooth animation
                const diff = bar.targetHeight - bar.height
                bar.velocity += diff * 0.1
                bar.velocity *= 0.8
                bar.height += bar.velocity

                const x = i * (barWidth + barGap)
                const barHeight = bar.height * rect.height * 0.8
                const y = (rect.height - barHeight) / 2

                // Draw bar with gradient
                const gradient = ctx.createLinearGradient(x, y, x, y + barHeight)
                gradient.addColorStop(0, colors.secondary)
                gradient.addColorStop(1, colors.primary)

                ctx.fillStyle = gradient
                ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2)
                ctx.fill()

                // Add glow effect when active
                if (isActive) {
                    ctx.shadowBlur = 10
                    ctx.shadowColor = colors.glow
                    ctx.fill()
                    ctx.shadowBlur = 0
                }
            })

            animationRef.current = requestAnimationFrame(animate)
        }

        animate()

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current)
            }
        }
    }, [isActive, color])

    return (
        <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ width: '100%', height: '100%' }}
        />
    )
}
