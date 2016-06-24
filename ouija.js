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

function checkHot(){
	console.log('checking last 100 hot posts');
	r.get_hot('AskOuija', { limit: 100 }).then(hot => {
		hot.forEach(processPost);
	});
}

function processPost(post){
	if (post.link_flair_text) return;
	post.expand_replies().then(processComments);
}

function processComments(post){
	var length = post.comments.length,
		response;

	for (var i = 0; i < length; i++){
		response = getOuijaResponse(post.comments[i]);
		if (response){
			updatePostFlair(post, response);
			return;
		}
	}
}

function updatePostFlair(post, response){
	var letters = response.letters,
		text = 'Ouija says: ' + letters.join('');

	if (post.link_flair_text == text){
		console.log('confirmed flair: ' + text);
	} else {
		post.assign_flair({
			text,
			css_class: OUIJA_RESULT_CLASS
		}).catch(err => {
			console.error(err);
		});
		console.log('assigned flair: ' + text);

		notifyUser(post, response);
	}
}

function getBody(comment){
	if (!comment) return null;

	var body = comment.body.replace(link, '$1');
	if (body === '[deleted]') return '*';
	return body.replace(/\W/g, '').toUpperCase();
}

function getOuijaResponse(comment){
	var body = getBody(comment),
		letters = [];

	while (body && body.length === 1){
		letters.push(body);
		comment = comment.replies[0];
		body = getBody(comment);
	}

	if (!goodbye.test(body)){
		return false;
	}

	if (comment.score < COMMENT_SCORE_THRESHOLD){
		console.log('below threshold: '+letters.join('')+' | '+comment.score+' points');
		return false;
	}

	return {
		letters,
		goodbye: comment
	};
}

function notifyUser(post, response){
	var url = post.url + response.goodbye.id + '?context=999',
		answer = response.letters.join('');

	var text = `**You asked:** ${post.title}`;
	text += "\n\n";
	text += `**Ouija says:** [${answer}](${url})`;

	r.compose_message({
		to: post.author,
		subject: 'THE OUIJA HAS SPOKEN',
		text,
		from_subreddit: 'AskOuija'
	});
}