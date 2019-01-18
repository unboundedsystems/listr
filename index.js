'use strict';
const PQueue = require('p-queue');
const pDefer = require('p-defer');
const Subject = require('rxjs').Subject;
const Task = require('./lib/task');
const TaskWrapper = require('./lib/task-wrapper');
const renderer = require('./lib/renderer');
const ListrError = require('./lib/listr-error');

const runTask = (task, context, errors) => {
	if (!task.isEnabled()) {
		return Promise.resolve();
	}

	return new TaskWrapper(task, errors).run(context);
};

class Listr extends Subject {
	constructor(tasks, opts) {
		super();
		if (tasks && !Array.isArray(tasks) && typeof tasks === 'object') {
			if (typeof tasks.title === 'string' && typeof tasks.task === 'function') {
				throw new TypeError('Expected an array of tasks or an options object, got a task object');
			}

			opts = tasks;
			tasks = [];
		}

		if (tasks && !Array.isArray(tasks)) {
			throw new TypeError('Expected an array of tasks');
		}

		this._options = Object.assign({
			showSubtasks: true,
			concurrent: false,
			renderer: 'default',
			nonTTYRenderer: 'verbose'
		}, opts);
		this._tasks = [];

		this.concurrency = 1;
		if (this._options.concurrent === true) {
			this.concurrency = Infinity;
		} else if (typeof this._options.concurrent === 'number') {
			this.concurrency = this._options.concurrent;
		}

		this._queue = new PQueue({concurrency: this.concurrency});

		this._RendererClass = renderer.getRenderer(this._options.renderer, this._options.nonTTYRenderer);

		this.exitOnError = this._options.exitOnError;

		this.add(tasks || []);
	}

	_checkAll(context) {
		for (const task of this._tasks) {
			task.check(context);
		}
	}

	get tasks() {
		return this._tasks;
	}

	setRenderer(value) {
		this._RendererClass = renderer.getRenderer(value);
	}

	add(task) {
		const tasks = Array.isArray(task) ? task : [task];

		for (const task of tasks) {
			const t = new Task(this, task, this._options);
			this._tasks.push(t);
			if (this.running) {
				this.next({
					type: 'ADDTASK',
					data: t
				});
				this.queueTask(t);
			}
		}

		return this;
	}

	queueTask(task) {
		this._queue.add(() => {
			if (this._errorThrown) {
				return;
			}

			this._checkAll(this._context);
			return runTask(task, this._context, this._errors)
				.catch(error => {
					this._errorThrown = true;
					throw error;
				});
		}).catch(this._done.reject);
	}

	render() {
		if (!this._renderer) {
			this._renderer = new this._RendererClass(this._tasks, this._options, this);
		}

		return this._renderer.render();
	}

	get running() {
		return this._renderer !== undefined;
	}

	run(context) {
		this.render();

		this._context = context || Object.create(null);

		this._errors = [];

		this._checkAll(this._context);

		// This is the promise that will settle when run() is complete.
		// It settles on one of two conditions:
		//   1. It resolves successfully when the task queue is idle (queue is
		//      empty and all promises have been resolved successfully)
		//   2. It rejects immediately if any task throws an error.
		this._done = pDefer();

		// Add all the tasks we have so far to the queue
		this._tasks.map(task => this.queueTask(task));

		this._queue.onIdle()
			.then(this._done.resolve) // Successful completion of all tasks
			.catch(this._done.reject);

		return this._done.promise
			.then(() => {
				// Check for errors from tasks with exitOnError===false
				if (this._errors.length > 0) {
					const err = new ListrError('Something went wrong');
					err.errors = this._errors;

					throw err;
				}

				// Mark the Observable as completed
				this.complete();

				this._renderer.end();

				return this._context;
			})
			.catch(error => {
				error.context = this._context;
				this.complete();
				this._renderer.end(error);
				throw error;
			});
	}
}

module.exports = Listr;
