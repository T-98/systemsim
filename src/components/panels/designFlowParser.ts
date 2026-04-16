/**
 * @file components/panels/designFlowParser.ts
 *
 * Local (no-LLM) schema parser for the Design flow. Accepts SQL-ish text
 * like `CREATE TABLE users (id UUID PRIMARY KEY, email VARCHAR)` and
 * returns `SchemaEntity[]`. Preserves entity IDs across re-parses by
 * matching on name.
 */

import { v4 as uuid } from 'uuid';
import { useStore } from '../../store';
import type { SchemaMemoryBlock, SchemaEntity, SchemaRelationship } from '../../types';

export function parseSchemaLocally(input: string): SchemaMemoryBlock {
  const version = (useStore.getState().schemaHistory.length || 0) + 1;
  const priorEntities = useStore.getState().schemaMemory?.entities ?? [];
  const priorByName = new Map(priorEntities.map((e) => [e.name, e]));
  const entities: SchemaEntity[] = [];
  const relationships: SchemaRelationship[] = [];

  const lines = input.split('\n').map((l) => l.trim()).filter(Boolean);
  let currentEntity: SchemaEntity | null = null;

  for (const line of lines) {
    const tableMatch = line.match(/^(\w+)\s+table\s*:/i) || line.match(/^CREATE\s+TABLE\s+(\w+)/i);
    if (tableMatch) {
      if (currentEntity) entities.push(currentEntity);
      const prior = priorByName.get(tableMatch[1]);
      currentEntity = {
        id: prior?.id ?? uuid(),
        name: tableMatch[1],
        fields: [],
        indexes: [],
        accessPatterns: [],
        assignedDbId: prior?.assignedDbId ?? null,
      };

      const fieldPart = line.split(':').slice(1).join(':');
      if (fieldPart) {
        const fieldStrs = fieldPart.split(',');
        for (const fs of fieldStrs) {
          const parts = fs.trim().split(/\s+/);
          if (parts.length >= 1) {
            const name = parts[0].replace(/[()]/g, '');
            const type = parts[1]?.replace(/[()]/g, '') ?? 'text';
            const isFk = fs.toLowerCase().includes('fk');
            const isPk = fs.toLowerCase().includes('pk');
            const cardinality: 'low' | 'medium' | 'high' = isPk ? 'high' : isFk ? 'medium' : 'high';

            if (name && name.length > 0) {
              currentEntity.fields.push({
                name,
                type,
                cardinality,
                notes: isPk ? 'primary key' : isFk ? `foreign key${fs.match(/FK\s+(\S+)/i)?.[1] ? ` to ${fs.match(/FK\s+(\S+)/i)![1]}` : ''}` : undefined,
              });

              if (isFk) {
                const fkTarget = fs.match(/FK\s+(\w+)\.(\w+)/i);
                if (fkTarget) {
                  relationships.push({
                    from: `${currentEntity.name}.${name}`,
                    to: `${fkTarget[1]}.${fkTarget[2]}`,
                    type: 'many_to_one',
                  });
                }
              }
            }
          }
        }
      }
      continue;
    }

    if (currentEntity) {
      const partitionMatch = line.match(/partition\s+key\s*:\s*(\w+)/i);
      if (partitionMatch) {
        currentEntity.partitionKey = partitionMatch[1];
        if (partitionMatch[1].toLowerCase().includes('user')) {
          currentEntity.partitionKeyCardinalityWarning = true;
          const field = currentEntity.fields.find((f) => f.name === partitionMatch[1]);
          if (field) field.cardinality = 'medium';
        }
        continue;
      }

      const indexMatch = line.match(/index\s+on\s+(\w+)\s*\((\w+)\)/i) || line.match(/index\s+on\s+(\w+)/i);
      if (indexMatch) {
        currentEntity.indexes.push({
          field: indexMatch[1],
          type: (indexMatch[2] as 'btree' | 'hash') ?? 'btree',
        });
        continue;
      }

      const accessMatch = line.match(/access\s*:\s*(.+)/i);
      if (accessMatch) {
        const desc = accessMatch[1];
        if (desc.toLowerCase().includes('write')) {
          currentEntity.accessPatterns.push({ operation: 'write', frequency: 'very_high', pattern: desc });
        }
        if (desc.toLowerCase().includes('read')) {
          currentEntity.accessPatterns.push({ operation: 'read', frequency: 'high', pattern: desc });
        }
        continue;
      }
    }
  }

  if (currentEntity) entities.push(currentEntity);

  let aiNotes = '';
  for (const entity of entities) {
    if (entity.partitionKeyCardinalityWarning) {
      aiNotes += `Partition key ${entity.partitionKey} on ${entity.name} has medium cardinality. In a notification system with large server memberships, this concentrates writes for active users on their shard.`;
    }
  }

  return { version, entities, relationships, aiNotes };
}
