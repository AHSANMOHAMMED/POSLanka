'use client'

import { Modal } from '@/components/ui/modal'
import { allVariableGroups } from '@/lib/notifications/templates/variables'

interface VariablePickerProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (variable: string) => void
}

export function VariablePicker({ isOpen, onClose, onSelect }: VariablePickerProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Insert Variable">
      <div className="p-4 max-h-[60vh] overflow-y-auto">
        <p className="text-sm text-gray-500 mb-4">
          Click a variable to insert it into your message. Variables will be replaced with actual values when the message is sent.
        </p>

        <div className="space-y-6">
          {allVariableGroups.map((group) => (
            <div key={group.name}>
              <h4 className="font-medium text-sm text-gray-900 mb-2">{group.name}</h4>
              <p className="text-xs text-gray-500 mb-2">{group.description}</p>

              <div className="grid grid-cols-2 gap-2">
                {group.variables.map((variable) => (
                  <button
                    key={variable.key}
                    onClick={() => onSelect(variable.key)}
                    className="text-left p-2 rounded-md border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-colors"
                  >
                    <div className="font-mono text-xs text-blue-600">
                      {`{{${variable.key}}}`}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">{variable.label}</div>
                    <div className="text-xs text-gray-400 truncate">{variable.example}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
