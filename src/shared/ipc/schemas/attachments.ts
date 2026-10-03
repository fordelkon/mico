import { IpcChannel } from '../../IpcChannel'
import type { IpcMethod } from '../contracts'
import * as z from 'zod'

import { ChatDocumentPartSchema, CodeDocumentsMaxTextBytes } from '../../data/schemas/chat'
import { defineSchema } from '../../data/define'

const CodeDocumentPartsSchema = defineSchema(
  z
    .array(ChatDocumentPartSchema)
    .refine(
      (documents) =>
        documents.reduce(
          (total, document) => total + new TextEncoder().encode(document.text).byteLength,
          0
        ) <= CodeDocumentsMaxTextBytes,
      { message: 'Attached documents must not exceed 1 MiB in total.' }
    )
)

interface AttachmentsAPI {
  pickCodeDocuments: IpcMethod<IpcChannel.Attachments_PickCodeDocuments>
}

export { CodeDocumentPartsSchema, type AttachmentsAPI }
