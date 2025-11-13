import { useEffect, useMemo, useRef, useState } from 'react'
import Spline from '@splinetool/react-spline'

function App() {
  const defaultPrompt = 'Describe the future of AI in space exploration, with stunning visuals of advanced spacecraft.'
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [textResp, setTextResp] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [script, setScript] = useState('')

  // Video generation state
  const canvasRef = useRef(null)
  const [recording, setRecording] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const startTimeRef = useRef(0)
  const rafRef = useRef(0)
  const imageRef = useRef(null)

  const BACKEND_URL = useMemo(() => {
    const env = import.meta.env.VITE_BACKEND_URL
    if (env) return env.replace(/\/$/, '')
    // Fallback: try same host with backend path (proxy in dev) or same origin
    return ''
  }, [])

  const api = async (path, body) => {
    const url = (BACKEND_URL || '') + path
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `Request failed: ${res.status}`)
    }
    return res.json()
  }

  const handleGenerate = async (e) => {
    e?.preventDefault()
    setError('')
    setLoading(true)
    setVideoUrl('')
    try {
      const [t, img, sc] = await Promise.all([
        api('/api/generate/text', { prompt }),
        api('/api/generate/image', { prompt }),
        api('/api/generate/script', { prompt }),
      ])
      setTextResp(t.text)
      setImageDataUrl(img.data_url)
      setScript(sc.script)
      // Prepare image element for canvas animation
      const im = new Image()
      im.onload = () => {
        imageRef.current = im
      }
      im.src = img.data_url
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // Canvas animation for video (60s)
  const drawFrame = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const now = performance.now()
    const elapsed = (now - startTimeRef.current) / 1000

    // Clear
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Background stars
    const seed = Math.floor(elapsed * 10)
    for (let i = 0; i < 200; i++) {
      const x = (i * 97 + seed * 13) % canvas.width
      const y = (i * 71 + seed * 29) % canvas.height
      const b = (i % 5) / 10 + 0.2
      ctx.fillStyle = `rgba(255,255,255,${b})`
      ctx.fillRect(x, y, 2, 2)
    }

    // Pan/zoom of generated image
    if (imageRef.current) {
      const img = imageRef.current
      const t = elapsed
      const zoom = 1.05 + 0.15 * Math.sin(t * 0.5)
      const panX = Math.sin(t * 0.3) * 50
      const panY = Math.cos(t * 0.25) * 30

      const iw = canvas.width * zoom
      const ih = canvas.height * zoom
      const ix = - (iw - canvas.width) / 2 + panX
      const iy = - (ih - canvas.height) / 2 + panY

      // Draw the SVG rasterized; browser handles it via <img>
      ctx.drawImage(img, ix, iy, iw, ih)
    }

    // Overlay title
    ctx.font = '24px Inter, system-ui, -apple-system, Segoe UI, Roboto'
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillText('AI Power · 1-Minute Visual', 24, 40)

    rafRef.current = requestAnimationFrame(drawFrame)
  }

  const startRecording = async () => {
    if (!canvasRef.current) return
    setVideoUrl('')

    const stream = canvasRef.current.captureStream(30)
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
    chunksRef.current = []
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data)
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      setVideoUrl(url)
      setRecording(false)
    }

    recorderRef.current = rec
    startTimeRef.current = performance.now()
    setRecording(true)
    rec.start()
    drawFrame()

    // Stop after 60s
    setTimeout(() => {
      stopRecording()
    }, 60_000)
  }

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    cancelAnimationFrame(rafRef.current)
  }

  useEffect(() => {
    // Initial generation
    handleGenerate()
    // Cleanup on unmount
    return () => {
      cancelAnimationFrame(rafRef.current)
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Podcast via Speech Synthesis (client-side TTS)
  const [speaking, setSpeaking] = useState(false)
  const utterRef = useRef(null)

  const playTTS = () => {
    if (!script) return
    const synth = window.speechSynthesis
    if (!synth) {
      alert('Speech Synthesis not supported in this browser.')
      return
    }
    if (speaking) return

    // Chunk long script to keep voices responsive
    const chunks = []
    const words = script.split(/\s+/)
    let buf = []
    for (const w of words) {
      buf.push(w)
      if (buf.join(' ').length > 600) {
        chunks.push(buf.join(' '))
        buf = []
      }
    }
    if (buf.length) chunks.push(buf.join(' '))

    setSpeaking(true)
    const queue = [...chunks]

    const speakNext = () => {
      if (!queue.length) {
        setSpeaking(false)
        return
      }
      const part = queue.shift()
      const ut = new SpeechSynthesisUtterance(part)
      ut.rate = 0.95
      ut.pitch = 1.0
      ut.onend = speakNext
      utterRef.current = ut
      synth.speak(ut)
    }
    speakNext()
  }

  const stopTTS = () => {
    const synth = window.speechSynthesis
    if (synth && synth.speaking) synth.cancel()
    setSpeaking(false)
  }

  return (
    <div className="min-h-screen w-full bg-[#0b0f1a] text-white">
      <header className="relative h-[55vh] w-full overflow-hidden">
        <Spline scene="https://prod.spline.design/4Zh-Q6DWWp5yPnQf/scene.splinecode" style={{ width: '100%', height: '100%' }} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0b0f1a]/30 to-[#0b0f1a] pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 px-6 md:px-12 pb-8">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">AI Power</h1>
          <p className="mt-3 text-sm md:text-base text-slate-300 max-w-3xl">
            A streamlined Gemini-like creative engine. Enter a prompt once to generate conversation-grade text, a vivid image, a 1-minute video, and a 10-minute podcast script with voice playback.
          </p>
        </div>
      </header>

      <main className="px-6 md:px-12 -mt-20">
        <form onSubmit={handleGenerate} className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-4 md:p-6">
          <label className="block text-sm text-slate-300 mb-2">Enter your prompt</label>
          <div className="flex flex-col md:flex-row gap-3">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="flex-1 rounded-xl bg-white/10 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-sky-400 placeholder-slate-400"
              placeholder="Describe your idea..."
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center rounded-xl bg-sky-500 hover:bg-sky-400 active:bg-sky-600 transition px-5 py-3 font-medium"
            >
              {loading ? 'Generating…' : 'Generate All'}
            </button>
          </div>
          {error && <p className="mt-3 text-red-300 text-sm">{error}</p>}
        </form>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-8">
          <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-6">
            <h2 className="text-xl font-semibold">AI Conversation</h2>
            <p className="mt-2 text-slate-300 whitespace-pre-wrap leading-relaxed">{textResp || 'Your response will appear here.'}</p>
          </div>

          <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-6">
            <h2 className="text-xl font-semibold">Visual (Image)</h2>
            {imageDataUrl ? (
              <img src={imageDataUrl} alt="Generated" className="mt-3 w-full rounded-xl border border-white/10" />
            ) : (
              <p className="mt-2 text-slate-300">Your image will appear here.</p>
            )}
            {imageDataUrl && (
              <a href={imageDataUrl} download="ai-power-image.svg" className="mt-3 inline-block text-sky-300 hover:text-sky-200 text-sm">Download SVG</a>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
          <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-6">
            <h2 className="text-xl font-semibold">Video (1 Minute)</h2>
            <p className="text-slate-300 text-sm mt-1">We animate your visual into a 60s WebM video. Click Start to render; it will auto-stop at 60s.</p>
            <div className="mt-4">
              <canvas ref={canvasRef} width={1280} height={720} className="w-full rounded-xl border border-white/10 bg-black" />
              <div className="flex items-center gap-3 mt-3">
                {!recording ? (
                  <button onClick={startRecording} disabled={!imageDataUrl} className="rounded-lg bg-emerald-500 hover:bg-emerald-400 px-4 py-2 font-medium disabled:opacity-50">Start 60s Render</button>
                ) : (
                  <button onClick={stopRecording} className="rounded-lg bg-red-500 hover:bg-red-400 px-4 py-2 font-medium">Stop</button>
                )}
                {videoUrl && (
                  <>
                    <a className="text-sky-300 hover:text-sky-200" href={videoUrl} download="ai-power-video.webm">Download Video</a>
                    <video controls className="rounded-lg border border-white/10 max-h-48"><source src={videoUrl} type="video/webm" /></video>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-6">
            <h2 className="text-xl font-semibold">Podcast (10 Minutes)</h2>
            <p className="text-slate-300 text-sm mt-1">We generate a detailed script and play it with studio-style TTS using your browser.</p>
            <div className="mt-3 flex gap-3">
              <button onClick={playTTS} disabled={!script || speaking} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-4 py-2 font-medium disabled:opacity-50">Play</button>
              <button onClick={stopTTS} className="rounded-lg bg-slate-600 hover:bg-slate-500 px-4 py-2 font-medium">Stop</button>
              {script && (
                <button onClick={() => navigator.clipboard.writeText(script)} className="rounded-lg bg-sky-600 hover:bg-sky-500 px-4 py-2 font-medium">Copy Script</button>
              )}
            </div>
            <article className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap leading-relaxed text-slate-200 text-sm">
              {script || 'Your 10-minute podcast script will appear here.'}
            </article>
          </div>
        </section>

        <footer className="py-10 text-center text-slate-500 text-sm">
          Built with AI Power · Prototype
        </footer>
      </main>
    </div>
  )
}

export default App
