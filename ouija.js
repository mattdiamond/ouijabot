'use strict';

// ------------- includes ------------------
const
	snoowrap = require('snoowrap'),
	moment = require('moment'),
	GraphemeSplitter = require('grapheme-splitter');

// -------------- config -------------------
const config = {
	client_id: process.env.CLIENT_ID,
	client_secret: process.env.CLIENT_SECRET,
	username: process.env.USERNAME,
	password: process.env.PASSWORD,
	user_agent: 'OuijaBot'
};

// -------- constants & variables ----------

const
	EOL = require('os').EOL,
	SUBREDDIT_NAME = 'AskOuija',
	OUIJA_RESULT_CLASS = 'ouija-result',
	COMMENT_SCORE_THRESHOLD = process.env.THRESHOLD ?? 10,
	LIMIT = process.env.LIMIT ?? 50,
	DELETE_DUPLICATES = false,

	r = new snoowrap(config),
	splitter = new GraphemeSplitter(),
	submissionId = process.argv[2],
	goodbyeRegex = /^GOODBYE/,
	link = /\[(.*?)\]\(.*?\)/g;

// -------------- { MAIN } -----------------

if (submissionId){
	processPost(r.getSubmission(submissionId));
} else {
	checkHot(LIMIT);
	checkReported();
}

// --------------- classes -----------------

class OuijaQuery {
	constructor(post){
		this.post = post;
		this.config = parseConfig(post.selftext);

		this.responses = {
			complete: [],
			incomplete: []
		};

		this.answered = false;
		this.isMeta = /\[meta\]/i.test(this.post.title);
		this.isModPost = this.post.distinguished === 'moderator';
	}

	async run (){
		var dupHandler = new CommentDuplicateHandler();
		await this.fetchComments();
		for (const comment of this.comments()){
			if (comment.type === OuijaComment.Types.Invalid){
				if (!this.isMeta && !this.isModPost) comment.remove('invalid');
				continue;
			}
			await this.collectResponses(comment);
			dupHandler.handle(comment);
		}

		var response = this.getResponse();
		if (response) this.answered = true;
		return response;
	}

	fetchComments () {
		if (this.post.comments.isFinished) {
			return;
		}

		return this.post.comments.fetchAll().then(comments => {
			this.post.comments = comments;
		});
	}

	* comments(){
		for (const comment of this.post.comments){
			yield new OuijaComment(comment);
		}
	}

	getTopCompletedResponse(){
		var top = null;
		this.responses.complete.forEach(response => {
			if (!top || response.goodbye.score > top.goodbye.score){
				top = response;
			}
		});
		return top;
	}

	get threshold(){
		return this.config.minscore || COMMENT_SCORE_THRESHOLD;
	}

	getResponse(){
		if (this.hasTimeLeft()) return null;

		var topResponse = this.getTopCompletedResponse();
		if (topResponse && topResponse.goodbye.score >= this.threshold){
			return topResponse;
		} else {
			return null;
		}
	}

	hasTimeLeft(){
		if (!this.config.time) return false;

		var
			creation = moment.unix(this.post.created_utc),
			duration = moment.duration('PT' + this.config.time.toUpperCase()),
			readyTime = creation.add(duration);

		return moment().isBefore(readyTime);
	}

	async collectResponses(comment, letters = []){
		switch (comment.type){
			case OuijaComment.Types.Invalid:
				comment.remove('invalid');
				return false;
			case OuijaComment.Types.Goodbye:
				if (this.config.minletters && letters.length < this.config.minletters){
					return false;
				}
				this.responses.complete.push({
					letters,
					goodbye: comment
				});
				return true;
			case OuijaComment.Types.Letter:
				letters = letters.concat(comment.body);
				const dupHandler = new CommentDuplicateHandler();
				let hasChildren = false;

				await comment.fetchReplies();
				for (const reply of comment.replies()){
					if (await isSelfReplyThread(reply, comment)){
						await killThread(reply);
						continue;
					}

					if (this.collectResponses(reply, letters)){
						hasChildren = true;
					}
					dupHandler.handle(reply);
				}
				if (!hasChildren){
					this.responses.incomplete.push({
						letters,
						lastComment: comment
					});
				}
				return true;
		}
	}
}

async function killThread(comment){
	await comment.fetchReplies();
	for (const reply of comment.replies()){
		await killThread(reply);
	}
	await comment.remove('self-reply');
}

async function isSelfReplyThread(reply, parent){
	if (reply.author.name !== parent.author.name) return false;

	await reply.fetchReplies();

	for (const r of reply.replies()){
		if (!(await isSelfReplyThread(r, parent))){
			return false;
		}
	}
	return true;
}

class OuijaComment {
	constructor(comment){
		this.snooObj = comment;
		this.body = this.parseBody(comment.body);
		this.repliesFetched = false;

		if (comment.banned_by){
			this.removed = true;
			this.type = OuijaComment.Types.Invalid;
		} else if (countSymbols(this.body) === 1){
			this.type = OuijaComment.Types.Letter;
		} else if (goodbyeRegex.test(this.body)){
			this.type = OuijaComment.Types.Goodbye;
		} else {
			this.type = OuijaComment.Types.Invalid;
		}

		// add fallback to original comment object
		return new Proxy(this, {
			get: (target, prop) => target[prop] || comment[prop]
		});
	}

	parseBody(body){
		if (body === '[deleted]') return '*';
		body = body.replace(link, '$1');
		body = body.replace('\\', '').trim();
		if (countSymbols(body) > 1){
			body = body.replace(/\W/g, '');
		}
		if (body === 'ß') return body;
		return body.toUpperCase();
	}

	hasReplies(){
		return this.snooObj.replies.length > 0;
	}

	fetchReplies () {
		if (this.repliesFetched || this.snooObj.replies.isFinished) {
			return;
		}
		return this.snooObj.replies.fetchAll().then(replies => {
			this.snooObj.replies = replies;
			this.repliesFetched = true;
		});
	}

	* replies() {
		for (const reply of this.snooObj.replies){
			yield new OuijaComment(reply);
		}
	}

	get created(){
		return this.snooObj.created_utc;
	}

	remove(reason){
		if (this.removed) return;
		console.log(`removing reply ${this.id} (reason: ${reason || 'not specified'})`);
		return this.snooObj.remove();
	}
}

OuijaComment.Types = {
	Letter: 'letter',
	Goodbye: 'goodbye',
	Invalid: 'invalid'
};

class CommentDuplicateHandler {
	constructor(){
		this.comments = {};
	}

	handle(comment){
		if (!DELETE_DUPLICATES) return;

		var key = comment.body,
		    existing = this.comments[key];

		if (existing){
			if (comment.created > existing.created && !comment.hasReplies()){
				comment.remove('duplicate');
			} else if (!existing.hasReplies()){
				existing.remove('duplicate');
				this.comments[key] = comment;
			}
		} else {
			this.comments[key] = comment;
		}
	}
}

// -------------- functions ----------------

function checkHot(limit){
	if (limit == null) {
		throw new Error('No limit specified');
	}

	console.log(`checking last ${limit} hot posts`);
	r.getHot(SUBREDDIT_NAME, { limit })
		.then(posts => {
			return Promise.all(
				posts.filter(isUnanswered).map(processPost)
			);
		})
		.then(processPending)
		.catch(console.error);
}

function checkReported(){
	const getReports = r.getSubreddit(SUBREDDIT_NAME).getReports({ only: 'links' });
	getReports.then(reports => {
		reports.forEach(post => {
			if (reportedIncorrectFlair(post)){
				processPost(post);
				post.approve();
			}
		});
	});
}

function reportedIncorrectFlair(post){
	return post.user_reports.some(report =>
		report[0] === 'Missing or Incorrect Flair'
	);
}

function isUnanswered(post){
	return !post.link_flair_text || post.link_flair_text === 'unanswered';
}

function processPending(queries){
	let text = '';

	queries.reverse().forEach(query => {
		if (query.answered) return;

		text += `### [${query.post.title}](${query.post.url})` + EOL;

		if (query.responses.complete.length){
			text += createPendingWikiMarkdown(query);
		}
		if (query.responses.incomplete.length){
			text += createIncompleteWikiMarkdown(query);
		}
	});

	const wiki = r.getSubreddit(SUBREDDIT_NAME).getWikiPage('unanswered');
	wiki.edit({ text });
}

function createPendingWikiMarkdown(query){
	let markdown = '#### Pending' + EOL;
	markdown += 'Letters | Score' + EOL;
	markdown += '--------|------' + EOL;
	query.responses.complete.forEach(pending => {
		var answer = pending.letters.join('') || '[blank]',
			url = query.post.url + pending.goodbye.id + '?context=999',
			score = pending.goodbye.score;

		markdown += `[${answer}](${url}) | ${score}` + EOL;
	});

	return markdown;
}

function createIncompleteWikiMarkdown(query){
	var markdown = '#### Incomplete' + EOL;
	markdown += 'Letters |' + EOL;
	markdown += '--------|' + EOL;
	query.responses.incomplete.forEach(sequence => {
		var answer = sequence.letters.join(''),
			url = query.post.url + sequence.lastComment.id + '?context=999';

		markdown += `[${answer}](${url}) |` + EOL;
	});

	return markdown;
}

function processPost(post){
	return post.fetch().then(runQuery);
	// return post.expand_replies().then(runQuery);
}

async function runQuery(post){
	const query = new OuijaQuery(post);

	const response = await query.run();

	if (response){
		updatePostFlair(post, response);
	} else if (post.link_flair_text !== 'unanswered') {
		post.assignFlair({
			text: 'unanswered',
			css_class: 'unanswered'
		});
	}

	return query;
}

function parseConfig(input){
	var regex = /(\w+)\s*:\s*(\w+)/g,
		config = {}, parsed;

	while ((parsed = regex.exec(input)) !== null){
		config[parsed[1]] = parsed[2];
	}

	return config;
}

function updatePostFlair(post, response){
	var letters = response.letters,
		text = 'Ouija says: ' + letters.join('');

	if (text.length > 64){
		text = text.substr(0, 61) + '...';
	}

	if (post.link_flair_text == text){
		console.log('confirmed flair: ' + text);
	} else {
		post.assignFlair({
			text,
			css_class: OUIJA_RESULT_CLASS
		}).catch(err => {
			console.error(err);
		});
		console.log('assigned flair: ' + text + ' | ' + post.url);

		notifyUser(post, response);
	}
}

function countSymbols(string) {
	return splitter.countGraphemes(string);
}

function notifyUser(post, response){
	var url = post.url + response.goodbye.id + '?context=999',
		answer = response.letters.join('');

	var text = `**You asked:** ${post.title}` + EOL;
	text += EOL;
	text += `**Ouija says:** [${answer}](${url})`;

	r.composeMessage({
		to: post.author,
		subject: 'THE OUIJA HAS SPOKEN',
		text,
		from_subreddit: SUBREDDIT_NAME
	});
}
