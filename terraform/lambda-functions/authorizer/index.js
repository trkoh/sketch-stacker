const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const sm = new SecretsManagerClient({ region: process.env.AWS_DEFAULT_REGION });
let cachedSecret = null;

// Secrets Managerから認証情報を取得（キャッシュ付き）
async function getSecret() {
  if (cachedSecret) {
    return cachedSecret;
  }

  try {
    const command = new GetSecretValueCommand({
      SecretId: process.env.SECRET_ARN
    });

    const response = await sm.send(command);
    const secret = JSON.parse(response.SecretString);

    cachedSecret = {
      username: process.env.AUTH_USERNAME,
      password: secret.secret_key
    };

    return cachedSecret;
  } catch (error) {
    console.error('Failed to retrieve secret:', error);
    throw error;
  }
}

exports.handler = async (event) => {
  // iOS Shortcutsは異なるヘッダー形式で送信する可能性があるため、より柔軟に処理
  const authHeader = event.headers.Authorization ||
                     event.headers.authorization ||
                     event.headers['Authorization'] ||
                     event.headers['authorization'];

  if (!authHeader) {
    console.log('No authorization header found');
    return generatePolicy('user', 'Deny', event.methodArn);
  }

  if (!authHeader.startsWith('Basic ')) {
    console.log('Authorization header is not Basic auth');
    return generatePolicy('user', 'Deny', event.methodArn);
  }

  try {
    const encodedCreds = authHeader.split(' ')[1];
    if (!encodedCreds) {
      console.log('No encoded credentials found');
      return generatePolicy('user', 'Deny', event.methodArn);
    }

    const plainCreds = Buffer.from(encodedCreds, 'base64').toString().split(':');
    const username = plainCreds[0];
    const password = plainCreds[1];

    // Secrets Managerから認証情報を動的取得
    const credentials = await getSecret();

    if (username === credentials.username && password === credentials.password) {
      console.log('Authentication successful');
      // 認証結果はトークン単位でキャッシュされるため、API全体(stage配下)をワイルドカード許可し、
      // upload と delete など複数メソッドで同じキャッシュを使い回せるようにする
      const apiWildcardArn = event.methodArn.split('/').slice(0, 2).join('/') + '/*';
      return generatePolicy('user', 'Allow', apiWildcardArn);
    }

    console.log('Authentication failed');
    return generatePolicy('user', 'Deny', event.methodArn);
  } catch (error) {
    console.error('Error processing authorization:', error);
    return generatePolicy('user', 'Deny', event.methodArn);
  }
};

const generatePolicy = (principalId, effect, resource) => {
  return {
    principalId: principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource
      }]
    }
  };
};