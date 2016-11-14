'use strict';

// ------------- includes ------------------
var snoowrap = require('snoowrap'),
	moment = require('moment');

// -------------- config -------------------
const config = {
	client_id: process.env.client_id,
	client_secret: process.env.client_secret,
	username: process.env.username,
	password: process.env.password,
	user_agent: 'OuijaBot'
};

// -------- constants & variables ----------

const
	EOL = require('os').EOL,
	OUIJA_RESULT_CLASS = 'ouija-result',
	COMMENT_SCORE_THRESHOLD = process.env.threshold;

var
	r = new snoowrap(config),
	submissionId = process.argv[2],
	goodbyeRegex = /^GOODBYE/,
	link = /\[(.*?)\]\(.*?\)/g;

// -------------- { MAIN } -----------------

if (submissionId){
	processPost(r.get_submission(submissionId));
} else {
	checkHot();
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
	}

	run(){
		for (let comment of this.post.comments){
			this.collectResponses(new OuijaComment(comment));
		}

		var response = this.getResponse();
		if (response) this.answered = true;
		return response;
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

	collectResponses(comment, letters){
		var letters = letters || [];

		if (comment.type === OuijaComment.Types.Letter){
			letters.push(comment.body);
			var childLetters = {}, hasChildren = false;
			for (let reply of comment.replies){
				reply = new OuijaComment(reply);
				if (reply.type !== OuijaComment.Types.Invalid){
					this.collectResponses(reply, letters);
					if (reply.type === OuijaComment.Types.Letter){
						checkForDuplicate(reply, childLetters);
					}
					hasChildren = true;
				}
			}
			if (!hasChildren){
				this.responses.incomplete.push({
					letters: letters.slice(),
					lastComment: comment
				});
			}
			letters.pop();
		} else if (comment.type === OuijaComment.Types.Goodbye){
			this.responses.complete.push({
				letters: letters.slice(),
				goodbye: comment
			});
		}
	}
}

class OuijaComment {
	constructor(comment){
		this.id = comment.id;
		this.body = getBody(comment);

		this.snooObj = comment;

		if (comment.banned_by){
			this.type = OuijaComment.Types.Invalid;
		} else if (countSymbols(this.body) === 1){
			this.type = OuijaComment.Types.Letter;
		} else if (goodbyeRegex.test(this.body)){
			this.type = OuijaComment.Types.Goodbye;
		} else {
			this.type = OuijaComment.Types.Invalid;
		}
	}

	get replies(){
		return this.snooObj.replies;
	}

	get created(){
		return this.snooObj.created_utc;
	}

	get score(){
		return this.snooObj.score;
	}

	remove(){
		return this.snooObj.remove();
	}
}

OuijaComment.Types = {
	Letter: 'letter',
	Goodbye: 'goodbye',
	Invalid: 'invalid'
};

// -------------- functions ----------------

function checkHot(){
	console.log('checking last 100 hot posts');
	var processing = [];
	r.get_hot('AskOuija', { limit: 100 }).then(hot => {
		hot.forEach(post => {
			if (isUnanswered(post)){
				processing.push(processPost(post));
			}
		});
		Promise.all(processing).then(processPending).catch(err => {
			console.error(err);
		});
	});
}

function checkReported(){
	var getReports = r.get_subreddit('AskOuija').get_reports({ only: 'links' });
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
	for (let userReport of post.user_reports){
		if (userReport[0] === 'Missing or Incorrect Flair') return true;
	}

	return false;
}

function isUnanswered(post){
	return !post.link_flair_text || post.link_flair_text === 'unanswered';
}

function processPending(queries){
	var text = '';

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

	var wiki = r.get_subreddit('AskOuija').get_wiki_page('unanswered');
	wiki.edit({ text });
}

function createPendingWikiMarkdown(query){
	var markdown = '#### Pending' + EOL;
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
	return post.expand_replies().then(runQuery);
}

function runQuery(post){
	var query = new OuijaQuery(post);

	var response = query.run();
	if (response){
		updatePostFlair(post, response);
	} else if (post.link_flair_text !== 'unanswered') {
		post.assign_flair({
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
		post.assign_flair({
			text,
			css_class: OUIJA_RESULT_CLASS
		}).catch(err => {
			console.error(err);
		});
		console.log('assigned flair: ' + text + ' | ' + post.url);

		notifyUser(post, response);
	}
}

//awesome workaround from https://mathiasbynens.be/notes/javascript-unicode
//for getting accurate character count even when handling emojis
function countSymbols(string) {
	// Do not count emoji variations and modifiers, http://unicode.org/reports/tr51/index.html
	string = string.replace(/[\u{20E0}\u{20E3}\u{FE0E}\u{FE0F}\u{1F3FB}-\u{1F3FF}]/ug,'');
	return Array.from(string).length;
}

function getBody(comment){
	if (!comment) return null;

	var body = comment.body;
	if (body === '[deleted]') return '*';
	body = body.replace(link, '$1');
	body = body.replace('\\', '').trim();
	if (countSymbols(body) > 1){
		body = body.replace(/\W/g, '');
	}
	if (body === 'ß') return body;
	return body.toUpperCase();
}

function notifyUser(post, response){
	var url = post.url + response.goodbye.id + '?context=999',
		answer = response.letters.join('');

	var text = `**You asked:** ${post.title}` + EOL;
	text += EOL;
	text += `**Ouija says:** [${answer}](${url})`;

	r.compose_message({
		to: post.author,
		subject: 'THE OUIJA HAS SPOKEN',
		text,
		from_subreddit: 'AskOuija'
	});
}

function checkForDuplicate(reply, children){
	var key = reply.body,
	    existing = children[key];

	if (existing){
		if (reply.created > existing.created){
			console.log('removing duplicate: ' + reply.id);
			reply.remove();
		} else {
			console.log('removing duplicate: ' + existing.id);
			existing.remove();
			children[key] = reply;
		}
	} else {
		children[key] = reply;
	}
}