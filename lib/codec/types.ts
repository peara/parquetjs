import { PrimitiveType } from "lib/types/types";
import { ParquetCodec, OriginalType, ParquetField } from "lib/types/types";
import { Statistics } from "gen-nodejs/parquet_types";

export interface Options {
    typeLength: number,
    bitWidth: number,
    disableEnvelope: boolean
    primitiveType?: PrimitiveType;
    originalType?: OriginalType;
    encoding?: ParquetCodec;
    compression?: string,
    column?: ParquetField,
    rawStatistics?: Statistics,
    cache?: unknown,
    dictionary?: Array<number>
    num_values?: number
    rLevelMax?: number,
    dLevelMax?: number,
    type?: string,
}
  
export interface Cursor {
    buffer: Buffer,
    offset: number,
    size?: number,
}