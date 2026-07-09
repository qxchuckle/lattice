/**
 * 全局常量 — Lattice 运行时配置常量收口
 *
 * 规则：
 * - 并发数、阈值、批次大小等全局常量统一在此定义
 * - 搜索调参常量（boost / threshold）属于搜索模块内部调参，不在此文件
 */

import { availableParallelism } from 'node:os';

/**
 * 并发数：根据 CPU 核心数动态设置，最少 4
 *
 * 用于 scan 目录扫描、RAG embedding 生成等 IO/CPU 密集型批处理
 */
export const CONCURRENCY = Math.max(4, availableParallelism());
