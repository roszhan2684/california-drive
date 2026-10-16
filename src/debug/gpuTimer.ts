/** GPU frame timing via EXT_disjoint_timer_query_webgl2 (when available). */
export class GpuTimer {
  private gl: WebGL2RenderingContext;
  private ext: any;
  private queries: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  ms = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  get supported() {
    return !!this.ext;
  }

  begin() {
    if (!this.ext || this.active) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.queries.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll() {
    const gl = this.gl;
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (!disjoint) this.ms = this.ms * 0.9 + (gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6) * 0.1;
      gl.deleteQuery(q);
      this.queries.shift();
    }
    if (this.queries.length > 6) { for (const q of this.queries.splice(0, this.queries.length - 6)) gl.deleteQuery(q); }
  }
}
