import { useEffect, useRef, useState } from 'react';

/**
 * Contador de FPS via `requestAnimationFrame`, mostrado no canto do canvas
 * só quando o dataset "Sintético (fps)" está ativo — é o objetivo daquele
 * dataset: medir se a aba engasga com ~300 nós.
 */
export function FpsCounter() {
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const lastSampleRef = useRef(performance.now());

  useEffect(() => {
    let rafId: number;

    function tick() {
      frameCountRef.current += 1;
      const now = performance.now();
      const elapsed = now - lastSampleRef.current;
      if (elapsed >= 500) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        lastSampleRef.current = now;
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return <div className="fps-counter">{fps} fps</div>;
}
