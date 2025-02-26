import * as parquet_util from "../util";
import parquet_thrift from "../../gen-nodejs/parquet_types";
import sbbf from "../bloom/sbbf";
import { ParquetEnvelopeReader } from "../reader"
import { ColumnChunkData } from "../types/types";

const filterColumnChunksWithBloomFilters = (
  columnChunkDataCollection: Array<ColumnChunkData>
) => {
  return columnChunkDataCollection.filter((columnChunk) => {
    const {
      column: {
        meta_data: {
          bloom_filter_offset: { buffer: bloomFilterOffsetBuffer },
        },
      },
    } = columnChunk;
    return bloomFilterOffsetBuffer;
  });
};

type bloomFilterOffsetData = {
  columnName: string;
  offsetBytes: number;
  rowGroupIndex: number;
};

const toInteger = (buffer: Buffer) => {
  const integer = parseInt(buffer.toString("hex"), 16);

  if (integer >= Number.MAX_VALUE) {
    throw Error("Number exceeds Number.MAX_VALUE: Godspeed");
  }

  return integer;
};

export const parseBloomFilterOffsets = (
  ColumnChunkDataCollection: Array<ColumnChunkData>
): Array<bloomFilterOffsetData> => {
  return ColumnChunkDataCollection.map((columnChunkData) => {
    const {
      column: {
        meta_data: {
          bloom_filter_offset: { buffer: bloomFilterOffsetBuffer },
          path_in_schema: pathInSchema,
        },
      },
      rowGroupIndex,
    } = columnChunkData;

    return {
      offsetBytes: toInteger(bloomFilterOffsetBuffer),
      columnName: pathInSchema.join(","),
      rowGroupIndex,
    };
  });
};

const getBloomFilterHeader = async (
  offsetBytes: number,
  envelopeReader: InstanceType<typeof ParquetEnvelopeReader>
) => {
  const headerByteSizeEstimate = 200;

  let bloomFilterHeaderData;
  try {
    bloomFilterHeaderData = await envelopeReader.read(
      offsetBytes,
      headerByteSizeEstimate
    );
  } catch (e) {
    if (typeof e === 'string') throw new Error(e);
    else throw e
  }

  const bloomFilterHeader = new parquet_thrift.BloomFilterHeader();
  const sizeOfBloomFilterHeader = parquet_util.decodeThrift(
    bloomFilterHeader,
    bloomFilterHeaderData
  );

  return {
    bloomFilterHeader,
    sizeOfBloomFilterHeader,
  };
};

const readFilterData = async (
  offsetBytes: number,
  envelopeReader: InstanceType<typeof ParquetEnvelopeReader>
): Promise<Buffer> => {
  const {
    bloomFilterHeader,
    sizeOfBloomFilterHeader,
  } = await getBloomFilterHeader(offsetBytes, envelopeReader);

  const { numBytes: filterByteSize } = bloomFilterHeader;

  try {
    const filterBlocksOffset = offsetBytes + sizeOfBloomFilterHeader;
    const buffer = await envelopeReader.read(
      filterBlocksOffset,
      filterByteSize
    );

    return buffer;
  } catch (e) {
    if (typeof e === 'string') throw new Error(e);
    else throw e
  }
};

const readFilterDataFrom = (
  offsets: Array<number>,
  envelopeReader: InstanceType<typeof ParquetEnvelopeReader>
): Promise<Array<Buffer>> => {
  return Promise.all(
    offsets.map((offset) => readFilterData(offset, envelopeReader))
  );
};

export const siftAllByteOffsets = (
  columnChunkDataCollection: Array<ColumnChunkData>
): Array<bloomFilterOffsetData> => {
  return parseBloomFilterOffsets(
    filterColumnChunksWithBloomFilters(columnChunkDataCollection)
  );
};

export const getBloomFiltersFor = async (
  columnNames: Array<string>,
  envelopeReader: InstanceType<typeof ParquetEnvelopeReader>
) => {
  const columnChunkDataCollection = envelopeReader.getAllColumnChunkDataFor(
    columnNames
  );
  const bloomFilterOffsetData = siftAllByteOffsets(columnChunkDataCollection);
  const offsetByteValues = bloomFilterOffsetData.map(
    ({ offsetBytes }) => offsetBytes
  );

  const filterBlocksBuffers: Array<Buffer> = await readFilterDataFrom(
    offsetByteValues,
    envelopeReader
  );

  return filterBlocksBuffers.map((buffer, index) => {
    const { columnName, rowGroupIndex } = bloomFilterOffsetData[index];

    return {
      sbbf: sbbf.from(buffer),
      columnName,
      rowGroupIndex,
    };
  });
};
