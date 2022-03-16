import * as parquet_types from './types'
import { ParquetSchema } from './schema'
import { Page, PageData, ParquetField } from './types/types';

/**
 * 'Shred' a record into a list of <value, repetition_level, definition_level>
 * tuples per column using the Google Dremel Algorithm..
 *
 * The buffer argument must point to an object into which the shredded record
 * will be returned. You may re-use the buffer for repeated calls to this function
 * to append to an existing buffer, as long as the schema is unchanged.
 *
 * The format in which the shredded records will be stored in the buffer is as
 * follows:
 *
 *   buffer = {
 *     columnData: [
 *       'my_col': {
 *          dlevels: [d1, d2, .. dN],
 *          rlevels: [r1, r2, .. rN],
 *          values: [v1, v2, .. vN],
 *        }, ...
 *      ],
 *      rowCount: X,
 *   }
 *
 */

export interface RecordBuffer {
  columnData?: Record<string, PageData>
  rowCount?: number,
  pageRowCount?: number,
  pages?: Record<string,Page[]>
}

export const shredRecord = function(schema: ParquetSchema, record: Record<string, unknown>, buffer: RecordBuffer) {
  /* shred the record, this may raise an exception */
  var recordShredded: Record<string, PageData> = {};
  for (let field of schema.fieldList) {
    recordShredded[field.path.join(',')] = {
      dlevels: [],
      rlevels: [],
      values: [],
      distinct_values: new Set(),
      count: 0
    };
  }

  shredRecordInternal(schema.fields, record, recordShredded, 0, 0);

  /* if no error during shredding, add the shredded record to the buffer */
  if (!('columnData' in buffer) || !('rowCount' in buffer)) {
    buffer.rowCount = 0;
    buffer.pageRowCount = 0;
    buffer.columnData = {};
    buffer.pages = {};

    for (let field of schema.fieldList) {
      let path = field.path.join(',')
      buffer.columnData[path] = {
        dlevels: [],
        rlevels: [],
        values: [],
        distinct_values: new Set(),
        count: 0
      };
      buffer.pages[path] = [];
    }
  }

  (buffer.rowCount as number) += 1;
  (buffer.pageRowCount as number) += 1;
  for (let field of schema.fieldList) {
    let path = field.path.join(',')
    let record = recordShredded[path];
    let column = buffer.columnData![path];

    for (let i = 0; i < record.rlevels!.length; i++) {
      column.rlevels!.push(record.rlevels![i]);
      column.dlevels!.push(record.dlevels![i]);
      if (record.values![i] !== undefined) {
        column.values!.push(record.values![i]);
      }
    }

    [...recordShredded[path].distinct_values!].forEach(value => buffer.columnData![path].distinct_values!.add(value));

    buffer.columnData![path].count! += recordShredded[path].count!;
  }
};

function shredRecordInternal(fields: Record<string, ParquetField>, record: Record<string, unknown> | null, data: Record<string, PageData>, rlvl: number, dlvl: number) {
  for (let fieldName in fields) {
    const field = fields[fieldName];
    const fieldType = field.originalType || field.primitiveType;
    const path = field.path.join(',')

    // fetch values
    let values: Array<unknown> = [];
    if (record && (fieldName in record) && record[fieldName] !== undefined && record[fieldName] !== null) {
      if (Array.isArray(record[fieldName])) {
        values = record[fieldName] as Array<unknown>;
      } else {
        values.push(record[fieldName]);
      }
    }

    // check values
    if (values.length == 0 && !!record && field.repetitionType === 'REQUIRED') {
      throw 'missing required field: ' + field.name;
    }

    if (values.length > 1 && field.repetitionType !== 'REPEATED') {
      throw 'too many values for field: ' + field.name;
    }

    // push null
    if (values.length == 0) {
      if (field.isNested && isDefined(field.fields)) {
        shredRecordInternal(
            field.fields,
            null,
            data,
            rlvl,
            dlvl);
      } else {
        data[path].rlevels!.push(rlvl);
        data[path].dlevels!.push(dlvl);
        data[path].count! += 1;
      }
      continue;
    }

    // push values
    for (let i = 0; i < values.length; ++i) {
      const rlvl_i = i === 0 ? rlvl : field.rLevelMax;

      if (field.isNested && isDefined(field.fields)) {
        shredRecordInternal(
            field.fields,
            values[i] as Record<string, unknown>,
            data,
            rlvl_i,
            field.dLevelMax);
      } else {
        data[path].distinct_values!.add(values[i]);
        data[path].values!.push(parquet_types.toPrimitive(fieldType as string, values[i]));
        data[path].rlevels!.push(rlvl_i);
        data[path].dlevels!.push(field.dLevelMax);
        data[path].count! += 1;
      }
    }
  }
}

/**
 * 'Materialize' a list of <value, repetition_level, definition_level>
 * tuples back to nested records (objects/arrays) using the Google Dremel
 * Algorithm..
 *
 * The buffer argument must point to an object with the following structure (i.e.
 * the same structure that is returned by shredRecords):
 *
 *   buffer = {
 *     columnData: [
 *       'my_col': {
 *          dlevels: [d1, d2, .. dN],
 *          rlevels: [r1, r2, .. rN],
 *          values: [v1, v2, .. vN],
 *        }, ...
 *      ],
 *      rowCount: X,
 *   }
 *
 */

export const materializeRecords = function(schema: ParquetSchema, buffer: RecordBuffer, records?: Array<Record<string, unknown>>) {
  if (!records) {
    records = [];
  }

  for (let k in buffer.columnData) {
    const field = schema.findField(k);
    const fieldBranch = schema.findFieldBranch(k);
    let values = buffer.columnData[k].values![Symbol.iterator]();

    let rLevels = new Array(field.rLevelMax + 1);
    rLevels.fill(0);

    for (let i = 0; i < buffer.columnData[k].count!; ++i) {
      const dLevel = buffer.columnData[k].dlevels![i];
      const rLevel = buffer.columnData[k].rlevels![i];

      rLevels[rLevel]++;
      rLevels.fill(0, rLevel + 1);

      let value = null;
      if (dLevel === field.dLevelMax) {
        value = parquet_types.fromPrimitive(
            field.originalType || field.primitiveType,
            values.next().value);
      }

      records[rLevels[0] - 1] = records[rLevels[0] - 1] || {};

      materializeRecordField(
          records[rLevels[0] - 1] as Record<string, unknown>,
          fieldBranch,
          rLevels.slice(1),
          dLevel,
          value);
    }
  }

  return records;
}

function materializeRecordField(record: Record<string, unknown>, branch: Array<ParquetField>, rLevels: Array<number>, dLevel: number, value: Record<string, unknown>) {
  const node = branch[0];

  if (dLevel < node.dLevelMax) {
    return;
  }

  if (branch.length > 1) {
    if (node.repetitionType === "REPEATED") {
      if (!(node.name in record)) {
        record[node.name] = [];
      }
      const recordValue = record[node.name] as Array<Record<string, unknown>>

      while (recordValue.length < rLevels[0] + 1) {
        recordValue.push({});
      }

      materializeRecordField(
          recordValue[rLevels[0]],
          branch.slice(1),
          rLevels.slice(1),
          dLevel,
          value);
    } else {
      record[node.name] = record[node.name] || {};

      const recordValue = record[node.name] as Record<string, unknown>
      materializeRecordField(
          recordValue,
          branch.slice(1),
          rLevels,
          dLevel,
          value);
    }
  } else {
    if (node.repetitionType === "REPEATED") {
      if (!(node.name in record)) {
        record[node.name] = [];
      }
      const recordValue = record[node.name] as Array<Record<string, unknown> | null>

      while (recordValue.length < rLevels[0] + 1) {
        recordValue.push(null);
      }

      recordValue[rLevels[0]] = value;
    } else {
      record[node.name] = value;
    }
  }
}

function isDefined<T>(val: T | undefined): val is T {
  return val !== undefined;
}
