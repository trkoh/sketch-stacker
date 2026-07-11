const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const sm = new SecretsManagerClient({ region: process.env.AWS_DEFAULT_REGION });
let cachedSecret = null;

// Secrets Managerから認証情報を取得（キャッシュ付き）。
// secret_key   = アップロード用パスワード（iOSショートカット/curl が使用）
// admin_key    = 管理モード用パスワード（?admin UI: メモ編集・意味検索・削除）
// 2キー構成のため、ローテーション時は必ず両キーを含むJSONで put-secret-value すること。
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
      uploadPassword: secret.secret_key,
      adminPassword: secret.admin_key
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
    return generatePolicy('user', 'Deny', [event.methodArn]);
  }

  if (!authHeader.startsWith('Basic ')) {
    console.log('Authorization header is not Basic auth');
    return generatePolicy('user', 'Deny', [event.methodArn]);
  }

  try {
    const encodedCreds = authHeader.split(' ')[1];
    if (!encodedCreds) {
      console.log('No encoded credentials found');
      return generatePolicy('user', 'Deny', [event.methodArn]);
    }

    const plainCreds = Buffer.from(encodedCreds, 'base64').toString().split(':');
    const username = plainCreds[0];
    const password = plainCreds[1];

    // Secrets Managerから認証情報を動的取得
    const credentials = await getSecret();

    if (username !== credentials.username) {
      console.log('Authentication failed');
      return generatePolicy('user', 'Deny', [event.methodArn]);
    }

    // 認証結果は Authorization ヘッダ単位でキャッシュ(TTL300s)されるため、
    // パスワードごとに許可範囲の異なるポリシーを返しても正しく分離される。
    // stage までの共通プレフィックス: arn:...:apiId/stage
    const stageArn = event.methodArn.split('/').slice(0, 2).join('/');

    // アップロード用パスワード: 従来どおり upload/delete（ショートカット・既存curl互換）に加え、
    // 写真アップロード(U-P1)も許可。書き込みのみで読み出し(GET /photos)は不可。
    if (password === credentials.uploadPassword) {
      console.log('Authentication successful (upload credential)');
      return generatePolicy('uploader', 'Allow', [
        `${stageArn}/POST/upload`,
        `${stageArn}/POST/photos`,
        `${stageArn}/DELETE/images/*`,
      ]);
    }

    // 管理モード用パスワード: ?admin UI が使うメモ編集・意味検索・削除・写真管理のみ。
    if (credentials.adminPassword && password === credentials.adminPassword) {
      console.log('Authentication successful (admin credential)');
      return generatePolicy('admin', 'Allow', [
        // 注意: IAM のワイルドカード memos/* は /memos 自体にはマッチしないため、
        // 一覧(GET /memos 等)は別エントリとして明示する。
        `${stageArn}/GET/memos`,
        `${stageArn}/GET/memos/*`,
        `${stageArn}/PUT/memos/*`,
        `${stageArn}/POST/search`,
        `${stageArn}/DELETE/images/*`,
        // U-P1 写真管理（一覧/アップロード/メモ編集/削除）
        `${stageArn}/GET/photos`,
        `${stageArn}/POST/photos`,
        `${stageArn}/PUT/photos/*`,
        `${stageArn}/DELETE/photos/*`,
      ]);
    }

    console.log('Authentication failed');
    return generatePolicy('user', 'Deny', [event.methodArn]);
  } catch (error) {
    console.error('Error processing authorization:', error);
    return generatePolicy('user', 'Deny', [event.methodArn]);
  }
};

const generatePolicy = (principalId, effect, resources) => {
  return {
    principalId: principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resources
      }]
    }
  };
};
