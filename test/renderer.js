import test from 'ava';
import delay from 'delay';
import Listr from '..';
import SimpleRenderer from './fixtures/simple-renderer';
import {testOutput} from './fixtures/utils';

test.serial('renderer class', async t => {
	const list = new Listr([
		{
			title: 'foo',
			task: () => Promise.resolve('bar')
		}
	], {renderer: SimpleRenderer});

	testOutput(t, [
		'foo [started]',
		'foo [completed]',
		'done'
	]);

	await list.run();
});

test.serial('add task during run', async t => {
	const list = new Listr([
		{
			title: 'one',
			task: () => {
				list.add({
					title: 'three',
					task: async () => {
						// Delay a bit to test whether the promise returned by
						// run() waits for this task.
						await delay(100);
						return '3';
					}
				});
				return Promise.resolve('1');
			}
		},
		{
			title: 'two',
			task: () => Promise.resolve('2')
		}
	], {renderer: SimpleRenderer});

	testOutput(t, [
		'one [started]',
		'three [task added]',
		'one [completed]',
		'two [started]',
		'two [completed]',
		'three [started]',
		'three [completed]',
		'done'
	]);

	await list.run();
});
