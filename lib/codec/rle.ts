import varint from 'varint'
import {Cursor, Options} from './types'

function encodeRunBitpacked(values: Array<number>, opts: Options) {
  for (let i = 0; i < values.length % 8; i++) {
    values.push(0);
  }

  let buf = Buffer.alloc(Math.ceil(opts.bitWidth * (values.length / 8)));
  for (let b = 0; b < opts.bitWidth * values.length; ++b) {
    if ((values[Math.floor(b / opts.bitWidth)] & (1 << b % opts.bitWidth)) > 0) {
      buf[Math.floor(b / 8)] |= (1 << (b % 8));
    }
  }

  return Buffer.concat([
    Buffer.from(varint.encode(((values.length / 8) << 1) | 1)),
    buf
  ]);
}

function encodeRunRepeated(value: number, count: number, opts: Options) {
  let buf = Buffer.alloc(Math.ceil(opts.bitWidth / 8));

  for (let i = 0; i < buf.length; ++i) {
    buf.writeUInt8(value & 0xff, i);
    value >> 8;
  }

  return Buffer.concat([
    Buffer.from(varint.encode(count << 1)),
    buf
  ]);
}

function unknownToParsedInt(value: string | number) {
  if (typeof value === 'string') {
    return parseInt(value, 10)
  } else {
    return value
  }
}

export const encodeValues = function(type: string, values: Array<number>, opts: Options) {
  if (!('bitWidth' in opts)) {
    throw 'bitWidth is required';
  }

  switch (type) {

    case 'BOOLEAN':
    case 'INT32':
    case 'INT64':
      values = values.map((x) => unknownToParsedInt(x));
      break;

    default:
      throw 'unsupported type: ' + type;
  }

  let buf = Buffer.alloc(0);
  let run = [];
  let repeats = 0;

  for (let i = 0; i < values.length; i++) {
    // If we are at the beginning of a run and the next value is same we start
    // collecting repeated values
    if ( repeats === 0 && run.length % 8 === 0 && values[i] === values[i+1]) {
      // If we have any data in runs we need to encode them
      if (run.length) {
        buf = Buffer.concat([buf, encodeRunBitpacked(run, opts)]);
        run = [];
      }
      repeats = 1;
    } else if (repeats > 0 && values[i] === values[i-1]) {
       repeats += 1;
    } else {
      // If values changes we need to post any previous repeated values
      if (repeats) {
        buf = Buffer.concat([buf, encodeRunRepeated(values[i-1], repeats, opts)]);
        repeats = 0;
      }
      run.push(values[i]);
    }
  }

  if (repeats) {
    buf = Buffer.concat([buf, encodeRunRepeated(values[values.length-1], repeats, opts)]);
  } else if (run.length) {
    buf = Buffer.concat([buf, encodeRunBitpacked(run, opts)]);
  }

  if (opts.disableEnvelope) {
    return buf;
  }

  let envelope = Buffer.alloc(buf.length + 4);
  envelope.writeUInt32LE(buf.length);
  buf.copy(envelope, 4);

  return envelope;
};

function decodeRunBitpacked(cursor : Cursor, count: number, opts: Options) {
  if (count % 8 !== 0) {
    throw 'must be a multiple of 8';
  }

  let values = new Array(count).fill(0);
  for (let b = 0; b < opts.bitWidth * count; ++b) {
    if (cursor.buffer[cursor.offset + Math.floor(b / 8)] & (1 << (b % 8))) {
      values[Math.floor(b / opts.bitWidth)] |= (1 << b % opts.bitWidth);
    }
  }

  cursor.offset += opts.bitWidth * (count / 8);
  return values;
}

function decodeRunRepeated(cursor: Cursor, count: number, opts: Options) {
  let value = 0;
  for (let i = 0; i < Math.ceil(opts.bitWidth / 8); ++i) {
    value << 8;
    value += cursor.buffer[cursor.offset];
    cursor.offset += 1;
  }

  return new Array(count).fill(value);
}

export const decodeValues = function(_: string, cursor: Cursor, count: number, opts: Options) {
  if (!('bitWidth' in opts)) {
    throw 'bitWidth is required';
  }

  if (!opts.disableEnvelope) {
    cursor.offset += 4;
  }

  let values = [];
  let res;

  while (values.length < count) {
    const header = varint.decode(cursor.buffer, cursor.offset);
    cursor.offset += varint.encodingLength(header);
    if (header & 1) {
      res = decodeRunBitpacked(cursor, (header >> 1) * 8, opts);
    } else {
      res = decodeRunRepeated(cursor, header >> 1, opts);
    }

    for (let i = 0; i < res.length; i++) {
      values.push(res[i]);
    }
  }
  values = values.slice(0,count);

  if (values.length !== count) {
    throw "invalid RLE encoding";
  }

  return values;
};
