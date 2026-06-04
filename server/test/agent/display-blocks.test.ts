import { describe, expect, it } from 'bun:test';
import { toDisplayBlocks } from '../../src/services/agent/display-blocks';

describe('toDisplayBlocks — Task tools', () => {
  describe('TaskCreate', () => {
    it('maps a successful create to a task create block', () => {
      const blocks = toDisplayBlocks(
        'TaskCreate',
        { subject: 'Fix the bug', description: 'Details here', activeForm: 'Fixing the bug' },
        'Created task #1',
        { task: { id: '1', subject: 'Fix the bug' } },
      );
      expect(blocks).toEqual([{ type: 'task', op: 'create', id: '1', title: 'Fix the bug' }]);
    });

    it('falls back to the result subject when input lacks one', () => {
      const blocks = toDisplayBlocks('TaskCreate', {}, '', {
        task: { id: '2', subject: 'From result' },
      });
      expect(blocks).toEqual([{ type: 'task', op: 'create', id: '2', title: 'From result' }]);
    });

    it('yields nothing without a structured result (failed create)', () => {
      expect(toDisplayBlocks('TaskCreate', { subject: 'X' }, 'error', undefined)).toEqual([]);
    });
  });

  describe('TaskUpdate', () => {
    it('maps a status change, normalizing completed → done', () => {
      const blocks = toDisplayBlocks(
        'TaskUpdate',
        { taskId: '1', status: 'completed' },
        'Updated',
        { success: true, taskId: '1', updatedFields: ['status'] },
      );
      expect(blocks).toEqual([{ type: 'task', op: 'update', id: '1', status: 'done' }]);
    });

    it('keeps deleted so the client can drop the task', () => {
      const blocks = toDisplayBlocks('TaskUpdate', { taskId: '3', status: 'deleted' }, '', {
        success: true,
        taskId: '3',
        updatedFields: ['status'],
      });
      expect(blocks).toEqual([{ type: 'task', op: 'update', id: '3', status: 'deleted' }]);
    });

    it('carries a subject rename', () => {
      const blocks = toDisplayBlocks(
        'TaskUpdate',
        { taskId: '1', subject: 'New title', status: 'in_progress' },
        '',
        { success: true, taskId: '1', updatedFields: ['subject', 'status'] },
      );
      expect(blocks).toEqual([
        { type: 'task', op: 'update', id: '1', title: 'New title', status: 'in_progress' },
      ]);
    });

    it('yields nothing for a rejected update', () => {
      const blocks = toDisplayBlocks('TaskUpdate', { taskId: '1', status: 'completed' }, '', {
        success: false,
        taskId: '1',
        updatedFields: [],
        error: 'nope',
      });
      expect(blocks).toEqual([]);
    });

    it('yields nothing for description/metadata-only updates', () => {
      const blocks = toDisplayBlocks('TaskUpdate', { taskId: '1', description: 'more' }, '', {
        success: true,
        taskId: '1',
        updatedFields: ['description'],
      });
      expect(blocks).toEqual([]);
    });
  });

  describe('TaskList', () => {
    it('maps the snapshot to a task list block', () => {
      const blocks = toDisplayBlocks('TaskList', {}, '', {
        tasks: [
          { id: '1', subject: 'A', status: 'completed', blockedBy: [] },
          { id: '2', subject: 'B', status: 'in_progress', blockedBy: [] },
          { id: '3', subject: 'C', status: 'pending', blockedBy: [] },
        ],
      });
      expect(blocks).toEqual([
        {
          type: 'task',
          op: 'list',
          items: [
            { id: '1', title: 'A', status: 'done' },
            { id: '2', title: 'B', status: 'in_progress' },
            { id: '3', title: 'C', status: 'pending' },
          ],
        },
      ]);
    });

    it('drops id-less entries (cannot be folded by id)', () => {
      const blocks = toDisplayBlocks('TaskList', {}, '', {
        tasks: [
          { id: '1', subject: 'A', status: 'pending', blockedBy: [] },
          { subject: 'no id', status: 'pending', blockedBy: [] },
        ],
      });
      expect(blocks).toEqual([
        { type: 'task', op: 'list', items: [{ id: '1', title: 'A', status: 'pending' }] },
      ]);
    });

    it('emits an empty snapshot (valid: no tasks)', () => {
      expect(toDisplayBlocks('TaskList', {}, '', { tasks: [] })).toEqual([
        { type: 'task', op: 'list', items: [] },
      ]);
    });

    it('yields nothing without a structured result', () => {
      expect(toDisplayBlocks('TaskList', {}, '', undefined)).toEqual([]);
    });
  });
});
