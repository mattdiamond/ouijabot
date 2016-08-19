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
	COMMENT_SCORE_THRESHOLD = process.env.threshold;

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

Function.prototype.if = function(condition){
	var func = this;
	return function(){
		if (condition.apply(this, arguments)){
			return func.apply(this, arguments);
		}
	};
};

function checkHot(){
	console.log('checking last 100 hot posts');
	r.get_hot('AskOuija', { limit: 100 }).then(hot => {
		hot.forEach(processPost.if(isUnanswered));
	});
}

function isUnanswered(post){
	return !post.link_flair_text || post.link_flair_text === 'unanswered';
}

function processPost(post){
	post.expand_replies().then(processComments);
}

function processComments(post){
	var response;

	for (var comment of post.comments){
		response = getOuijaResponse.call(post, comment);
		if (response){
			updatePostFlair(post, response);
			return;
		}
	}

	if (post.link_flair_text !== 'unanswered'){
		post.assign_flair({
			text: 'unanswered',
			css_class: 'unanswered'
		});
	}
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

function getBody(comment){
	if (!comment) return null;

	var body = comment.body;
	if (body === '[deleted]') return '*';
	body = body.replace(link, '$1').trim();
	if (body.length > 1){
		body = body.replace(/\W/g, '');
	}
	if (body === 'ß') return body;
	return body.toUpperCase();
}

function getOuijaResponse(comment, letters){
	var body = getBody(comment),
		letters = letters || [],
		response;

	if (body.length === 1){
		letters.push(body);
		for (var reply of comment.replies){
			response = getOuijaResponse.call(this, reply, letters);
			if (response) return response;
		}
		letters.pop();
	} else if (goodbye.test(body)){
		if (comment.score >= COMMENT_SCORE_THRESHOLD){
			return {
				letters,
				goodbye: comment
			};
		} else {
			console.log('almost there: ' + letters.join('') + ' | ' + comment.score + ' points | ' + this.url);
		}
	}

	return false;
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