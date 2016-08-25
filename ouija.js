// ------------- includes ------------------
var snoowrap = require('snoowrap');

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
	COMMENT_SCORE_THRESHOLD = process.env.threshold,
	INVALID = 0;

var
	r = new snoowrap(config),
	submissionId = process.argv[2],
	goodbye = /^GOODBYE/,
	link = /\[(.*?)\]\(.*?\)/g;

// -------------- { MAIN } -----------------

if (submissionId){
	processPost(r.get_submission(submissionId));
} else {
	checkHot();
}

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
		Promise.all(processing).then(processPending);
	});
}

function processPending(posts){
	var text = '';

	posts.reverse().forEach(post => {
		if (post.answered) return;
		if (!post.answers.pending.length && !post.answers.incomplete.length) return;

		text += `### [${post.title}](${post.url})` + EOL;

		if (post.answers.pending.length){
			text += createPendingWikiMarkdown(post);
		}
		if (post.answers.incomplete.length){
			text += createIncompleteWikiMarkdown(post);
		}
	});

	var wiki = r.get_subreddit('AskOuija').get_wiki_page('unanswered');
	wiki.edit({ text });
}

function createPendingWikiMarkdown(post){
	var markdown = '#### Pending' + EOL;
	markdown += 'Letters | Score' + EOL;
	markdown += '--------|------' + EOL;
	post.answers.pending.forEach(pending => {
		var answer = pending.letters.join('') || '[blank]',
			url = post.url + pending.goodbye.id + '?context=999',
			score = pending.goodbye.score;

		markdown += `[${answer}](${url}) | ${score}` + EOL;
	});

	return markdown;
}

function createIncompleteWikiMarkdown(post){
	var markdown = '#### Incomplete' + EOL;
	markdown += 'Letters |' + EOL;
	markdown += '--------|' + EOL;
	post.answers.incomplete.forEach(sequence => {
		var answer = sequence.letters.join(''),
			url = post.url + sequence.lastComment.id + '?context=999';

		markdown += `[${answer}](${url}) |` + EOL;
	});

	return markdown;
}

function isUnanswered(post){
	return !post.link_flair_text || post.link_flair_text === 'unanswered';
}

function processPost(post){
	return post.expand_replies().then(processComments);
}

function processComments(post){
	var context = { post, config: parseConfig(post.selftext) },
		response;

	post.answers = {
		pending: [],
		incomplete: []
	};

	for (var comment of post.comments){
		response = getOuijaResponse.call(context, comment);
		if (response){
			updatePostFlair(post, response);
			post.answered = true;
			return post;
		}
	}

	if (post.link_flair_text !== 'unanswered'){
		post.assign_flair({
			text: 'unanswered',
			css_class: 'unanswered'
		});
	}

	return post;
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
	return Array.from(string).length;
}

function getBody(comment){
	if (!comment) return null;

	var body = comment.body;
	if (body === '[deleted]') return '*';
	body = body.replace(link, '$1').trim();
	if (countSymbols(body) > 1){
		body = body.replace(/\W/g, '');
	}
	if (body === 'ß') return body;
	return body.toUpperCase();
}

function getOuijaResponse(comment, letters){
	var body = getBody(comment),
		letters = letters || [],
		hasChildren = false,
		response;

	if (countSymbols(body) === 1){
		letters.push(body);
		for (var reply of comment.replies){
			response = getOuijaResponse.call(this, reply, letters);
			if (response) return response;
			if (response !== INVALID) hasChildren = true;
		}
		if (!hasChildren){
			this.post.answers.incomplete.push({
				letters: letters.slice(),
				lastComment: comment
			});
		}
		letters.pop();
	} else if (goodbye.test(body)){
		var threshold = this.config.minscore || COMMENT_SCORE_THRESHOLD;

		if (comment.score >= threshold){
			return {
				letters,
				goodbye: comment
			};
		} else {
			console.log('below threshold: ' + letters.join('') + ' | ' + comment.score + ' points | ' + this.post.url);
			this.post.answers.pending.push({
				letters: letters.slice(),
				goodbye: comment
			});
		}
	} else {
		return INVALID;
	}
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