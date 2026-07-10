import concurrently from 'concurrently';
import fs from 'fs';
import path from 'path';
import process from 'process';

const ciTests = process.env.CI_TESTS === 'true';
const localTests = process.env.LOCAL_TESTS === 'true';
const postInstall = process.env.POSTINSTALL === 'true';

const mode = ciTests
	? 'ci-tests'
	: localTests
		? 'local-tests'
		: postInstall
			? 'postinstall'
			: 'local-dev';

const configPath = path.resolve('scripts', `${mode}.json`);

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

concurrently(config.commands, {
	prefix: config.prefix,
	killOthersOn: config.killOthers
});
