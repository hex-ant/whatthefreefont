/** Own workers from the moment they are created, including SDK initialization. */
export class OcrSession<T> {
  private workers = new Set<Worker>()
  private ready?: Promise<T>
  private active = true
  private rejectJob?: (error: Error) => void
  private onStatus: (message: string) => void = () => {}

  constructor(
    private factory: (
      own: (worker: Worker) => Worker,
      status: (message: string) => void,
    ) => Promise<T>,
  ) {}

  async run(
    operation: (engine: T) => Promise<import('./types').Recognition[]>,
    status: (message: string) => void,
    timeout = 120000,
  ) {
    if (!this.active) throw new Error('OCR session closed')
    this.onStatus = status
    return new Promise<import('./types').Recognition[]>((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('OCR timeout')), timeout)
      const cleanup = () => {
        clearTimeout(timer)
        this.rejectJob = undefined
        this.onStatus = () => {}
      }
      this.rejectJob = (error) => {
        cleanup()
        reject(error)
      }
      this.ready ||= Promise.resolve().then(() =>
        this.factory(
          (worker) => {
            if (!this.active) {
              worker.terminate()
              throw new Error('OCR session closed')
            }
            this.workers.add(worker)
            return worker
          },
          (message) => {
            if (this.active) this.onStatus(message)
          },
        ),
      )
      this.ready
        .then((engine) => {
          if (!this.active) throw new Error('OCR session closed')
          return operation(engine)
        })
        .then(
          (result) => {
            if (this.active) {
              cleanup()
              resolve(result)
            }
          },
          (error) => this.close(error instanceof Error ? error : new Error(String(error))),
        )
    })
  }

  close(error = new Error('OCR cancelled')) {
    if (!this.active) return
    this.active = false
    for (const worker of this.workers) worker.terminate()
    this.workers.clear()
    this.ready = undefined
    this.rejectJob?.(error)
  }
}
