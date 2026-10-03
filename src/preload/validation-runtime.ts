import * as z from 'zod'

// Configure before shared schemas initialize: Electron's isolated preload rejects
// even Zod's caught eval-capability probe and reports it as a renderer failure.
z.config({ jitless: true })
