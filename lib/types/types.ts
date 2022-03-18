// Lifted from https://github.com/kbajalc/parquets

import parquet_thrift from "../../gen-nodejs/parquet_types";
import { Statistics, OffsetIndex, ColumnIndex, PageType, DataPageHeader, DataPageHeaderV2, DictionaryPageHeader, IndexPageHeader, Type } from "../../gen-nodejs/parquet_types";
import SplitBlockBloomFilter from "lib/bloom/sbbf";
import { createSBBFParams } from "lib/bloomFilterIO/bloomFilterWriter";

export type ParquetCodec = 'PLAIN' | 'RLE';
export type ParquetCompression = 'UNCOMPRESSED' | 'GZIP' | 'SNAPPY' | 'LZO' | 'BROTLI' | 'LZ4';
export type RepetitionType = 'REQUIRED' | 'OPTIONAL' | 'REPEATED';
export type ParquetType = PrimitiveType | OriginalType;

export type PrimitiveType =
// Base Types
    |'BOOLEAN' // 0
    | 'INT32' // 1
    | 'INT64' // 2
    | 'INT96' // 3
    | 'FLOAT' // 4
    | 'DOUBLE' // 5
    | 'BYTE_ARRAY' // 6,
    | 'FIXED_LEN_BYTE_ARRAY'; // 7

export type OriginalType =
// Converted Types
    | 'UTF8' // 0
    | 'MAP' // 1
    // | 'MAP_KEY_VALUE' // 2
     | 'LIST' // 3
    // | 'ENUM' // 4
    // | 'DECIMAL' // 5
    | 'DATE' // 6
    | 'TIME_MILLIS' // 7
    | 'TIME_MICROS' // 8
    | 'TIMESTAMP_MILLIS' // 9
    | 'TIMESTAMP_MICROS' // 10
    | 'UINT_8' // 11
    | 'UINT_16' // 12
    | 'UINT_32' // 13
    | 'UINT_64' // 14
    | 'INT_8' // 15
    | 'INT_16' // 16
    | 'INT_32' // 17
    | 'INT_64' // 18
    | 'JSON' // 19
    | 'BSON' // 20
    | 'INTERVAL'; // 21

export interface SchemaDefinition {
    [string: string]: FieldDefinition;
}

export interface FieldDefinition {
    type?: ParquetType;
    typeLength?: number;
    encoding?: ParquetCodec;
    compression?: ParquetCompression;
    optional?: boolean;
    repeated?: boolean;
    fields?: SchemaDefinition;
    statistics?: Statistics
    parent?: ParentField
    num_children?: NumChildrenField
}

export interface ParquetField {
    name: string;
    path: string[];
    statistics?: Statistics
    primitiveType?: PrimitiveType;
    originalType?: OriginalType;
    repetitionType: RepetitionType;
    typeLength?: number;
    encoding?: ParquetCodec;
    compression?: ParquetCompression;
    rLevelMax: number;
    dLevelMax: number;
    isNested?: boolean;
    fieldCount?: number;
    fields?: Record<string, ParquetField>;
    disableEnvelope?: boolean
}

interface ParentField {
    value: SchemaDefinition
    enumerable: boolean
}

interface NumChildrenField {
    value: number
    enumerable:boolean
}

export interface ParquetBuffer {
    rowCount?: number;
    columnData?: Record<string, PageData>;
}

export interface ParquetRecord {
    [key: string]: any;
}

export interface Offset {
    buffer: Buffer
    offset: number
}

export interface ColumnMetaData {
    type: Type,
    encodings: Array<any>,
    path_in_schema: Array<string>,
    codec: number,
    num_values: number,
    total_uncompressed_size: any,
    total_compressed_size: any,
    key_value_metadata: any,
    data_page_offset: Offset,
    index_page_offset: Offset,
    dictionary_page_offset: Offset,
    statistics: any,
    encoding_stats: any,
    bloom_filter_offset: Offset
    columnIndex?: ColumnIndex;
    offsetIndex?: OffsetIndex;
}

export interface ColumnData {
    file_path?: string,
    file_offset: Offset,
    meta_data?: ColumnMetaData
    offset_index_length?: number;
    column_index_length?: number;
    encrypted_column_metadata?: Buffer;
    offsetIndex?: OffsetIndex;
    offset_index_offset?: number;
    columnIndex?: ColumnIndex;
    column_index_offset?: number;
}

export interface ColumnChunkData {
    rowGroupIndex: number,
    column: ColumnData
}

export declare class KeyValue {
    key: string;
    value?: string;
}

export type Block = Uint32Array

export interface BloomFilterData {
    sbbf: SplitBlockBloomFilter,
    columnName: string,
    RowGroupIndex: number,
};

export interface Parameter {
    url: string;
    headers?: string
}

export interface PageData {
    rlevels?: number[];
    dlevels?: number[];
    distinct_values?: Set<any>
    values?: number[];
    pageHeaders?: PageHeader[];
    pageHeader?: PageHeader;
    count?: number;
    dictionary?: Array<unknown>
    column?: ColumnData
}

export declare class PageHeader {
    type: PageType;
    uncompressed_page_size: number;
    compressed_page_size: number;
    crc?: number;
    data_page_header?: DataPageHeader;
    index_page_header?: IndexPageHeader;
    dictionary_page_header?: DictionaryPageHeader;
    data_page_header_v2?: DataPageHeaderV2;
    offset?: number;
    headerSize?: number;
  
      constructor(args?: { type: PageType; uncompressed_page_size: number; compressed_page_size: number; crc?: number; data_page_header?: DataPageHeader; index_page_header?: IndexPageHeader; dictionary_page_header?: DictionaryPageHeader; data_page_header_v2?: DataPageHeaderV2; });
  }

  export interface ClientParameters {
    Bucket: string,
    Key: string
  }

  export interface PromiseS3 {
      promise: () => Promise<any>
  }

  export interface ClientS3 {
    accessKeyId: string,
    secretAccessKey: string,
    headObject: (params: ClientParameters) => PromiseS3
    getObject: (args: any) => PromiseS3
}

export class NewFileMetaData extends parquet_thrift.FileMetaData {
    json?:JSON;
    //@ts-ignore
    row_groups: NewRowGroup[];
    constructor() {
      super()
    } 
  }

export class NewPageHeader extends parquet_thrift.PageHeader {
    offset?: number;
    headerSize?: number;
    constructor() {
      super()
    } 
  }

  export class NewRowGroup extends parquet_thrift.RowGroup {
    //@ts-ignore
    columns: ColumnData[];
    //@ts-ignore
    num_rows: number;
    //@ts-ignore
    ordinal?: number;
    constructor() {
      super()
    } 
  }

  export class NewColumnMetaData extends parquet_thrift.ColumnMetaData {
    offsetIndex?: parquet_thrift.OffsetIndex
    columnIndex?: parquet_thrift.ColumnIndex
    constructor() {
        super()
      } 
  }

  
export type WriterOptions = {
    pageIndex?: boolean;
    pageSize?: number;
    useDataPageV2?: boolean;
    bloomFilters?: Record<string, SplitBlockBloomFilter>;
    baseOffset?: number;
    rowGroupSize?: number;
    flags?: string;
    encoding?: BufferEncoding | ParquetCodec;
    fd?: number;
    mode?: number;
    autoClose?: boolean;
    emitClose?: boolean;
    start?: number;
    highWaterMark?: number;
    column?: ParquetField;
    rowCount?: number;
}

export type Page = {
    page: Buffer,
    statistics: parquet_thrift.Statistics,
    first_row_index: number,
    distinct_values: Set<any>,
    num_values: number,
    count?: number,
}
