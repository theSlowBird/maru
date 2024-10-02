import { type MaruSongData, validate } from '@marure/schema'
import { parseSongData } from '~~/packages/parser/src'
import YAML from 'yaml'
import { _importingState, type FailedResult, type SucceededResult } from '~/state/import'

export const SUPPORTED_IMPORT_EXT = ['json', 'yml', 'yaml', 'zip']

async function * traverseFileList(files?: FileList | FileSystemEntry[]): AsyncGenerator<File> {
  for (const item of files || []) {
    if (item == null)
      continue
    if (item instanceof File) {
      yield item
    }
    else {
      if (item.isDirectory) {
        const dir = item as FileSystemDirectoryEntry
        const reader = dir.createReader()
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, reject)
        })
        yield * traverseFileList(entries)
      }
      else {
        if (item.isFile) {
          const file = await new Promise<File>((resolve, reject) => {
            (item as FileSystemFileEntry).file(resolve, reject)
          })

          if (file.name.match(/\.zip$/i)) {
            const zip = await import('jszip').then(r => r.loadAsync(file))
            for (const entry of Object.values(zip.files)) {
              if (entry.dir)
                continue
              const blob = await entry.async('blob')
              yield new File([blob], entry.name, { type: blob.type })
            }
          }
          else {
            yield file
          }
        }
      }
    }
  }
}

export async function *parseFiles(files?: FileList | FileSystemEntry[]): AsyncGenerator<SucceededResult | FailedResult> {
  for await (const file of traverseFileList(files)) {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase()
      let json: any
      switch (ext) {
        case 'json': {
          json = JSON.parse(await file.text())
          break
        }
        case 'yml':
        case 'yaml': {
          json = YAML.parse(await file.text())
          break
        }
        default:
          throw new Error(`Unsupported file extension: ${ext}`)
      }
      const data = validate(json)
      parseSongData(data)
      yield { filename: file.name, data }
    }
    catch (err) {
      console.error('Failed to import file:', file, err)
      yield { filename: file.name, error: err }
    }
  }
}

export function useImportingState() {
  return _importingState
}

export async function importFromFiles(files?: FileList | FileSystemEntry[] | null) {
  if (!files) {
    return
  }

  if (_importingState.value.isImporting && !_importingState.value.isFinished) {
    // eslint-disable-next-line no-alert
    alert('另一個匯入作業正在進行中，請等待完成後再試。')
    return
  }

  _importingState.value = {
    isImporting: true,
    isFinished: false,
    count: 0,
    succeeded: [],
    failed: [],
  }

  for await (const result of parseFiles(files)) {
    _importingState.value.count++
    if ('data' in result) {
      _importingState.value.succeeded.unshift(result)
      saveSongsToLocal([result.data])
    }
    else {
      _importingState.value.failed.unshift(result)
    }
  }

  _importingState.value.isFinished = true
}
