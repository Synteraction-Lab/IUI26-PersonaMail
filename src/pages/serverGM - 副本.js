const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3001;

const geminiApiKey = 'AIzaSyDmFDKI1XPwWO2EhqdRQZkTSl8N3ZfUCeM'; // Gemini API Key
//AIzaSyDim8J8xzRTmPl1ve98-gQq8UueGZhH9s8

const geminiApiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

const factorList = require('../../public/data/PredefinedData/factor_list.json'); // 引用 factor_list.json

app.use(cors());
app.use(express.json());

const MAX_RETRIES = 5;

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'api_logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// API Monitoring Middleware
const apiLogger = (req, res, next) => {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Log request data
    const requestLog = {
        requestId,
        timestamp,
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params
    };
    
    console.log(`\n🔵 [${timestamp}] ${req.method} ${req.url} - Request ID: ${requestId}`);
    console.log('📤 Request Data:', JSON.stringify(requestLog, null, 2));
    
    // Capture the original res.json method
    const originalJson = res.json;
    const originalSend = res.send;
    
    // Override res.json to capture response data
    res.json = function(data) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        const responseLog = {
            requestId,
            timestamp: new Date().toISOString(),
            statusCode: res.statusCode,
            data: data,
            duration: `${duration}ms`
        };
        
        console.log(`\n🟢 [${new Date().toISOString()}] ${req.method} ${req.url} - Response (${duration}ms)`);
        console.log('📥 Response Data:', JSON.stringify(responseLog, null, 2));
        
        // Save to log file
        saveApiLog(req.url, requestLog, responseLog);
        
        return originalJson.call(this, data);
    };
    
    // Override res.send to capture non-JSON responses
    res.send = function(data) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        const responseLog = {
            requestId,
            timestamp: new Date().toISOString(),
            statusCode: res.statusCode,
            data: data,
            duration: `${duration}ms`
        };
        
        console.log(`\n🟢 [${new Date().toISOString()}] ${req.method} ${req.url} - Response (${duration}ms)`);
        console.log('📥 Response Data:', JSON.stringify(responseLog, null, 2));
        
        // Save to log file
        saveApiLog(req.url, requestLog, responseLog);
        
        return originalSend.call(this, data);
    };
    
    next();
};

// Function to save API logs to file
const saveApiLog = (endpoint, requestLog, responseLog) => {
    try {
        const date = new Date().toISOString().split('T')[0];
        const logFileName = `api-logs-${date}.json`;
        const logFilePath = path.join(logsDir, logFileName);
        
        const logEntry = {
            endpoint: endpoint.replace(/[^a-zA-Z0-9-_]/g, '_'),
            request: requestLog,
            response: responseLog
        };
        
        let existingLogs = [];
        if (fs.existsSync(logFilePath)) {
            try {
                const fileContent = fs.readFileSync(logFilePath, 'utf-8');
                existingLogs = JSON.parse(fileContent);
            } catch (error) {
                console.warn('Could not parse existing log file:', error);
            }
        }
        
        existingLogs.push(logEntry);
        fs.writeFileSync(logFilePath, JSON.stringify(existingLogs, null, 2));
        
        console.log(`💾 Log saved to: ${logFilePath}`);
    } catch (error) {
        console.error('Error saving API log:', error);
    }
};

// Apply the logging middleware to all routes
app.use(apiLogger);

// Route to view API logs
app.get('/api-logs', (req, res) => {
    try {
        const { date, type } = req.query;
        const logDate = date || new Date().toISOString().split('T')[0];
        
        let logFileName;
        if (type === 'gemini') {
            logFileName = `gemini-logs-${logDate}.json`;
        } else {
            logFileName = `api-logs-${logDate}.json`;
        }
        
        const logFilePath = path.join(logsDir, logFileName);
        
        if (!fs.existsSync(logFilePath)) {
            return res.json({ 
                message: `No logs found for ${logDate}`,
                availableDates: getAvailableLogDates()
            });
        }
        
        const logs = JSON.parse(fs.readFileSync(logFilePath, 'utf-8'));
        
        res.json({
            date: logDate,
            type: type || 'api',
            totalEntries: logs.length,
            logs: logs,
            availableDates: getAvailableLogDates()
        });
    } catch (error) {
        console.error('Error reading logs:', error);
        res.status(500).json({ error: 'Error reading logs' });
    }
});

// Route to get available log dates
app.get('/api-logs/dates', (req, res) => {
    try {
        const dates = getAvailableLogDates();
        res.json({ availableDates: dates });
    } catch (error) {
        console.error('Error getting log dates:', error);
        res.status(500).json({ error: 'Error getting log dates' });
    }
});

// Helper function to get available log dates
const getAvailableLogDates = () => {
    try {
        const files = fs.readdirSync(logsDir);
        const dates = new Set();
        
        files.forEach(file => {
            if (file.match(/^(api|gemini)-logs-(\d{4}-\d{2}-\d{2})\.json$/)) {
                const match = file.match(/(\d{4}-\d{2}-\d{2})/);
                if (match) {
                    dates.add(match[1]);
                }
            }
        });
        
        return Array.from(dates).sort().reverse();
    } catch (error) {
        console.error('Error getting available dates:', error);
        return [];
    }
};

// Route to clear logs (for cleanup)
app.delete('/api-logs', (req, res) => {
    try {
        const { date, type } = req.query;
        
        if (date) {
            // Delete specific date logs
            let logFileName;
            if (type === 'gemini') {
                logFileName = `gemini-logs-${date}.json`;
            } else if (type === 'api') {
                logFileName = `api-logs-${date}.json`;
            } else {
                // Delete both types for the date
                const apiLogFile = `api-logs-${date}.json`;
                const geminiLogFile = `gemini-logs-${date}.json`;
                
                let deletedFiles = [];
                if (fs.existsSync(path.join(logsDir, apiLogFile))) {
                    fs.unlinkSync(path.join(logsDir, apiLogFile));
                    deletedFiles.push(apiLogFile);
                }
                if (fs.existsSync(path.join(logsDir, geminiLogFile))) {
                    fs.unlinkSync(path.join(logsDir, geminiLogFile));
                    deletedFiles.push(geminiLogFile);
                }
                
                return res.json({ 
                    message: `Deleted log files for ${date}`,
                    deletedFiles
                });
            }
            
            const logFilePath = path.join(logsDir, logFileName);
            if (fs.existsSync(logFilePath)) {
                fs.unlinkSync(logFilePath);
                res.json({ message: `Deleted ${logFileName}` });
            } else {
                res.status(404).json({ error: `Log file ${logFileName} not found` });
            }
        } else {
            // Clear all logs
            const files = fs.readdirSync(logsDir);
            const deletedFiles = [];
            
            files.forEach(file => {
                if (file.match(/^(api|gemini)-logs-.*\.json$/)) {
                    fs.unlinkSync(path.join(logsDir, file));
                    deletedFiles.push(file);
                }
            });
            
            res.json({ 
                message: 'All logs cleared',
                deletedFiles
            });
        }
    } catch (error) {
        console.error('Error clearing logs:', error);
        res.status(500).json({ error: 'Error clearing logs' });
    }
});


async function sendRequestToGemini(prompt, options = {}) {
    let retries = 0;
    const { enableThinking = false, timeout = 300000 } = options; // Default to 5 minutes timeout
    const geminiRequestId = `gemini-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    while (retries < MAX_RETRIES) {
        try {
            const requestBody = {
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    thinkingConfig: {
                        thinkingBudget: enableThinking ? 2000 : 0 
                    }
                }
            };

            console.log(`\n🤖 [${new Date().toISOString()}] Gemini API Request - ID: ${geminiRequestId}`);
            console.log('📤 Gemini Request Body:', JSON.stringify({
                ...requestBody,
                prompt_preview: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
                full_prompt_length: prompt.length
            }, null, 2));

            const response = await axios.post(geminiApiEndpoint, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: timeout, // Use custom timeout from options
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                // Add connection timeout and keep-alive settings
                httpAgent: new (require('http').Agent)({ 
                    keepAlive: true, 
                    timeout: 60000 // 1 minute connection timeout
                }),
                httpsAgent: new (require('https').Agent)({ 
                    keepAlive: true, 
                    timeout: 60000 // 1 minute connection timeout
                })
            });

            console.log(`\n🟢 [${new Date().toISOString()}] Gemini API Response - ID: ${geminiRequestId}`);
            console.log('📥 Gemini Response:', JSON.stringify({
                status: response.status,
                candidates_count: response.data?.candidates?.length || 0,
                finish_reason: response.data?.candidates?.[0]?.finishReason || 'unknown',
                response_preview: response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.substring(0, 200) + '...' || 'No content',
                full_response_length: response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.length || 0
            }, null, 2));

            // Save Gemini interaction to log file
            saveGeminiLog(geminiRequestId, {
                prompt,
                requestBody,
                response: response.data,
                retryAttempt: retries
            });

            if (response.data && response.data.candidates && response.data.candidates.length > 0 &&
                response.data.candidates[0].content && response.data.candidates[0].content.parts &&
                response.data.candidates[0].content.parts.length > 0) {
                const finishReason = response.data.candidates[0].finishReason;
                if (finishReason && finishReason !== 'STOP') {
                     console.warn(`⚠️ Gemini response finished with reason: ${finishReason}`);
                }
                return response.data.candidates[0].content.parts[0].text;
            } else if (response.data?.promptFeedback?.blockReason) {
                 console.error(`❌ Gemini request blocked: ${response.data.promptFeedback.blockReason}`, response.data.promptFeedback);
                 throw new Error(`Gemini request blocked due to: ${response.data.promptFeedback.blockReason}`);
            } else {
                console.error('❌ Invalid response structure from Gemini:', response.data);
                throw new Error('Gemini 响应结构无效');
            }
        } catch (error) {
            const errorMessage = error.response?.data?.error?.message || error.message;
            const isSocketError = error.code === 'ECONNABORTED' || errorMessage.includes('socket hang up') || errorMessage.includes('timeout');
            
            console.error(`❌ Gemini 请求出错（第 ${retries + 1} 次尝试）:`, errorMessage, error.response?.data);
            
            // Log the error
            saveGeminiLog(geminiRequestId, {
                prompt,
                error: errorMessage,
                retryAttempt: retries,
                errorDetails: error.response?.data,
                errorCode: error.code
            });
            
            retries++;
            if (retries === MAX_RETRIES) throw new Error(`达到最大重试次数: ${errorMessage}`);
            
            // For socket errors, use longer delays: 10s, 20s, 40s, 80s between retries
            const baseDelay = isSocketError ? 5000 : 2500;
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * baseDelay));
        }
    }
    throw new Error('Gemini request failed after multiple retries.');
}

// Function to save Gemini-specific logs
const saveGeminiLog = (geminiRequestId, logData) => {
    try {
        const date = new Date().toISOString().split('T')[0];
        const logFileName = `gemini-logs-${date}.json`;
        const logFilePath = path.join(logsDir, logFileName);
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            requestId: geminiRequestId,
            ...logData
        };
        
        let existingLogs = [];
        if (fs.existsSync(logFilePath)) {
            try {
                const fileContent = fs.readFileSync(logFilePath, 'utf-8');
                existingLogs = JSON.parse(fileContent);
            } catch (error) {
                console.warn('Could not parse existing Gemini log file:', error);
            }
        }
        
        existingLogs.push(logEntry);
        fs.writeFileSync(logFilePath, JSON.stringify(existingLogs, null, 2));
        
        console.log(`💾 Gemini log saved to: ${logFilePath}`);
    } catch (error) {
        console.error('Error saving Gemini log:', error);
    }
};

app.post('/generate-text', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "缺少 prompt 参数" });
    try {
        const generatedText = await sendRequestToGemini(prompt);
        if (!generatedText) {
            return res.status(500).json({ error: 'Gemini 响应为空' });
        }
        res.json({ text: generatedText.trim() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/save-log', async (req, res) => {
    const { userInput, prompt, toneFactors, finalEmail } = req.body;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const timestamp = now.getTime();
    const fileName = `${year}${month}${day}_${timestamp}.md`;
    const logDir = path.join(__dirname, '..', 'userLogs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logFilePath = path.join(logDir, fileName);

    const markdownContent = `# 邮件生成日志
• **UserInput**: ${userInput}
• **Selected Tone Factor**:
\`\`\`
${JSON.stringify(toneFactors, null, 2)}
\`\`\`
• **Request Prompt**:
\`\`\`
${prompt}
\`\`\`
• **Final Email**:
\`\`\`
${finalEmail}
\`\`\`
`;
    try {
        fs.writeFileSync(logFilePath, markdownContent);
        res.json({ message: '日志保存成功' });
    } catch (err) {
        console.error('保存日志时出错:', err);
        res.status(500).json({ error: '保存日志时出错' });
    }
});

app.post('/rank-and-revise-factors', async (req, res) => {
    const { userTask } = req.body;

    // 检查 userTask 是否存在
    if (!userTask) {
        return res.status(400).json({ error: "缺少 userTask 参数" });
    }

    // 加载 markdown 文件内容
    const promptPath = path.join(__dirname, '../../public/data/Prompts/contextual_factor_predictor.prompt.md');
    let promptTemplate;
    try {
        promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    } catch (error) {
        console.error('加载 prompt 文件失败:', error);
        return res.status(500).json({ error: '加载 prompt 文件失败' });
    }

    // 替换 markdown 文件中的占位符
    const prompt = promptTemplate
        .replace('{{USER_TASK}}', userTask)
        .replace('{{FACTOR_LIST}}', JSON.stringify(factorList, null, 2));
  
    try {
        const responseText = await sendRequestToGemini(prompt);
        if (!responseText) {
            return res.status(500).json({ error: 'Gemini 响应为空' });
        }

        // 移除 Markdown 格式的代码块标记
        const jsonContent = responseText.replace(/```json|```/g, ''); // 移除 ```json 和 ``` 标记

        // 解析 JSON
        let result;
        try {
            result = JSON.parse(jsonContent);
        } catch (error) {
            console.error('解析 JSON 失败:', jsonContent);
            return res.status(500).json({ error: '解析 JSON 失败' });
        }

        // 根据返回的 ranked_factor_ids 和 modified_options 构建结果
        const rankedFactors = result.ranked_factor_ids.map(id => {
            const factor = factorList.find(f => f.id === id);
            if (factor) {
                return {
                    ...factor,
                    options: result.modified_options[id] || factor.options
                };
            }
            console.warn(`未找到匹配的 factor: ${id}`);
            return null;
        }).filter(Boolean);

        res.json(rankedFactors);
    } catch (error) {
        console.error('Rank and revise factors 出错:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/generate-snippet', async (req, res) => {
    const { userTask, factorName, factorOption, factorChoices } = req.body;

    if (!userTask || !factorName || !factorOption || !factorChoices) {
        return res.status(400).json({ error: '缺少必要参数' });
    }

    // 加载 prompt 模板
    const promptPath = path.join(__dirname, '../../public/data/Prompts/snippet_generator_prompt.md');
    let promptTemplate;
    try {
        promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    } catch (error) {
        console.error('加载 prompt 文件失败:', error);
        return res.status(500).json({ error: '加载 prompt 文件失败' });
    }

    // 填充 prompt
    const prompt = promptTemplate
        .replace('{{USER_TASK}}', userTask) // 替换用户任务
        .replace('{{FACTOR_NAME}}', factorName) // 替换目标因子名称
        .replace('{{FACTOR_OPTION}}', factorOption) // 替换目标因子选项
        .replace(/{{FACTOR_CHOICES}}/g, JSON.stringify(factorChoices, null, 2)); // 替换因子选择列表（两处）

    try {
        // 调用 Gemini 服务生成 snippet
        const responseText = await sendRequestToGemini(prompt);
        if (!responseText) {
            throw new Error('Gemini 响应为空');
        }

        // 解析返回的 JSON 数据
        const jsonContent = responseText.replace(/```json|```/g, ''); // 移除 Markdown 格式标记
        const parsedData = JSON.parse(jsonContent);

        // 提取 snippet 字段
        const snippet = parsedData.snippet || '未生成 snippet';
        res.json({ snippet });
    } catch (error) {
        console.error('生成 snippet 出错:', error.message);
        res.status(500).json({ error: '生成 snippet 出错，请稍后重试' });
    }
});

// 创建会话接口 - 只在FirstPage调用
app.post('/create-session', (req, res) => {
    const { userName, userInput } = req.body;

    if (!userName || !userInput) {
        return res.status(400).json({ error: 'userName 和 userInput 是必需的' });
    }

    const sessionDataPath = path.join(__dirname, '../data/SessionData');
    const userPath = path.join(sessionDataPath, userName);
    const taskId = `${userName}_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const taskPath = path.join(userPath, taskId);

    try {
        // 确保 SessionData 根目录存在
        if (!fs.existsSync(sessionDataPath)) {
            fs.mkdirSync(sessionDataPath, { recursive: true });
        }

        // 创建用户目录（如果不存在）
        if (!fs.existsSync(userPath)) {
            fs.mkdirSync(userPath, { recursive: true });
        }

        // 创建 PersonaAnchor 目录
        const personaAnchorPath = path.join(userPath, 'PersonaAnchor');
        if (!fs.existsSync(personaAnchorPath)) {
            fs.mkdirSync(personaAnchorPath, { recursive: true });
        }

        // 创建 SituationAnchor 目录
        const situationAnchorPath = path.join(userPath, 'SituationAnchor');
        if (!fs.existsSync(situationAnchorPath)) {
            fs.mkdirSync(situationAnchorPath, { recursive: true });
        }

        // 创建 AdaptiveStylebook 目录
        const adaptiveStylebookPath = path.join(userPath, 'AdaptiveStylebook');
        if (!fs.existsSync(adaptiveStylebookPath)) {
            fs.mkdirSync(adaptiveStylebookPath, { recursive: true });
        }

        // 创建 AdaptiveStylebook.json 文件（如果不存在）
        const adaptiveStylebookJsonPath = path.join(adaptiveStylebookPath, 'AdaptiveStylebook.json');
        if (!fs.existsSync(adaptiveStylebookJsonPath)) {
            const adaptiveStylebookContent = { revision_records: [] };
            fs.writeFileSync(adaptiveStylebookJsonPath, JSON.stringify(adaptiveStylebookContent, null, 2));
        }

        // 创建任务目录
        if (!fs.existsSync(taskPath)) {
            fs.mkdirSync(taskPath, { recursive: true });
        }

        // 创建子目录
        const subDirs = ['meta', 'factors', 'intents', 'drafts', 'localized', 'logs'];
        subDirs.forEach((subDir) => {
            const subDirPath = path.join(taskPath, subDir);
            if (!fs.existsSync(subDirPath)) {
                fs.mkdirSync(subDirPath, { recursive: true });
            }
        });

        // 创建 task.json 在 meta 目录中
        const taskJsonPath = path.join(taskPath, 'meta', 'task.json');
        const taskJsonContent = {
            user: userName,
            task_id: taskId,
            created_iso: new Date().toISOString(),
            original_task: "", // Set original_task to an empty string
        };
        fs.writeFileSync(taskJsonPath, JSON.stringify(taskJsonContent, null, 2));

        // 创建 intents/history.json
        const historyPath = path.join(taskPath, 'intents', 'history.json');
        fs.writeFileSync(historyPath, JSON.stringify([], null, 2));

        // 创建 intents/current.json
        const currentPath = path.join(taskPath, 'intents', 'current.json');
        fs.writeFileSync(currentPath, JSON.stringify([], null, 2));

        // 创建 factors/choices.json
        const choicesPath = path.join(taskPath, 'factors', 'choices.json');
        fs.writeFileSync(choicesPath, JSON.stringify({}, null, 2));

        // 创建 drafts/00_first.md, drafts/01_regen.md, drafts/latest.md
        const draftsPath = path.join(taskPath, 'drafts');
        fs.writeFileSync(path.join(draftsPath, '00_first.md'), '');
        fs.writeFileSync(path.join(draftsPath, '01_regen.md'), '');
        fs.writeFileSync(path.join(draftsPath, 'latest.md'), '');

        // 创建 localized/001_variation.json, localized/002_direct_rewrite.json
        const localizedPath = path.join(taskPath, 'localized');
        fs.writeFileSync(path.join(localizedPath, '001_variation.json'), JSON.stringify({}, null, 2));
        fs.writeFileSync(path.join(localizedPath, '002_direct_rewrite.json'), JSON.stringify({}, null, 2));

        // 创建 logs/regen_01.json
        const logsPath = path.join(taskPath, 'logs');
        fs.writeFileSync(path.join(logsPath, 'regen_01.json'), JSON.stringify({}, null, 2));

        res.status(200).json({ message: 'Session 数据已创建', taskId });
    } catch (error) {
        console.error('创建 SessionData 目录或文件时出错:', error);
        res.status(500).json({ error: '创建 SessionData 目录或文件时出错' });
    }
});

// 保存factor choices接口 - 修复重复定义问题
app.post('/save-factor-choices', (req, res) => {
    const { userName, factorChoices, taskId } = req.body;

    if (!userName || !factorChoices || !taskId) {
        return res.status(400).json({ error: 'userName、factorChoices 和 taskId 是必需的' });
    }

    // 使用传入的taskId构建路径
    const factorChoicesPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'factors', 'choices.json');
    console.log('Saving factor choices to:', factorChoicesPath);

    try {
        // 确保目录存在
        const factorsDir = path.dirname(factorChoicesPath);
        if (!fs.existsSync(factorsDir)) {
            fs.mkdirSync(factorsDir, { recursive: true });
        }

        fs.writeFileSync(factorChoicesPath, JSON.stringify(factorChoices, null, 2));
        res.status(200).json({ message: 'Factor choices saved successfully' });
    } catch (error) {
        console.error('Error saving factor choices:', error);
        res.status(500).json({ error: 'Error saving factor choices' });
    }
});



app.post('/generate-first-draft', async (req, res) => {
    const { userTask, factorChoices } = req.body;

    if (!userTask || !factorChoices) {
        return res.status(400).json({ error: 'userTask and factorChoices are required' });
    }

    const promptPath = path.join(__dirname, '../../public/data/Prompts/4first_draft_composer.prompt.md');
    let promptTemplate;

    try {
        promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    } catch (error) {
        console.error('Failed to load 4first_draft_composer.prompt.md:', error);
        return res.status(500).json({ error: 'Failed to load prompt template' });
    }

    const prompt = promptTemplate
        .replace('{{USER_TASK}}', userTask)
        .replace('{{FACTOR_CHOICES}}', JSON.stringify(factorChoices, null, 2));

    try {
        const draftContent = await sendRequestToGemini(prompt, { enableThinking: false, timeout: 120000 }); // 2 minutes timeout

        if (!draftContent) {
            throw new Error('AI response is empty');
        }

        res.json({ draft: draftContent.trim() });
    } catch (error) {
        console.error('Error generating first draft:', error);
        res.status(500).json({ error: 'Failed to generate first draft' });
    }
});

app.post('/generate-anchor-email-draft', async (req, res) => {
  const { userTask, factorChoices, userName } = req.body;

  if (!userTask || !factorChoices || !userName) {
    return res.status(400).json({ error: 'userTask, factorChoices, and userName are required' });
  }

  const promptPath = path.join(__dirname, '../../public/data/Prompts/4.2Anchor_first_draft_composer.prompt.md');
  let promptTemplate;

  try {
    promptTemplate = fs.readFileSync(promptPath, 'utf-8');
  } catch (error) {
    console.error('Failed to load 4.2Anchor_first_draft_composer.prompt.md:', error);
    return res.status(500).json({ error: 'Failed to load prompt template' });
  }

  try {
    // Get all writing samples from user's task directories
    const userPath = path.join(__dirname, '../data/SessionData', userName);
    const writingSamples = [];
    
    if (fs.existsSync(userPath)) {
      const taskDirs = fs.readdirSync(userPath).filter(dir => {
        const taskPath = path.join(userPath, dir);
        return fs.statSync(taskPath).isDirectory() && dir.includes('_');
      });
      
      for (const taskDir of taskDirs) {
        const latestDraftPath = path.join(userPath, taskDir, 'drafts', 'latest.md');
        if (fs.existsSync(latestDraftPath)) {
          const content = fs.readFileSync(latestDraftPath, 'utf-8').trim();
          if (content) {
            writingSamples.push(content);
          }
        }
      }
    }

    // Use first two samples or empty strings if not available
    const previousEmail1 = writingSamples[0] || '';
    const previousEmail2 = writingSamples[1] || '';

    const prompt = promptTemplate
      .replace('{{USER_TASK}}', userTask)
      .replace('{{FACTOR_CHOICES}}', JSON.stringify(factorChoices, null, 2))
      .replace('{{PREVIOUS_EMAIL1}}', previousEmail1)
      .replace('{{PREVIOUS_EMAIL2}}', previousEmail2);

    const draftContent = await sendRequestToGemini(prompt);

    if (!draftContent) {
      throw new Error('AI response is empty');
    }

    res.json({ draft: draftContent.trim() });
  } catch (error) {
    console.error('Error generating anchor email draft:', error);
    res.status(500).json({ error: 'Failed to generate anchor email draft' });
  }
});

// 提供 SessionData 文件的静态访问
app.get('/sessiondata/:taskId/*', (req, res) => {
    const { taskId } = req.params;
    const filePath = req.params[0]; // 获取剩余的路径部分
    
    // 从 taskId 中提取用户名（假设格式为 userName_timestamp）
    const userName = taskId.split('_')[0];
    
    const fullPath = path.join(__dirname, '../data/SessionData', userName, taskId, filePath);
    
    console.log('请求文件路径:', fullPath);
    
    // 检查文件是否存在
    if (!fs.existsSync(fullPath)) {
        console.error('文件不存在:', fullPath);
        return res.status(404).json({ error: '文件不存在' });
    }
    
    try {
        // 根据文件扩展名设置正确的 Content-Type
        const ext = path.extname(fullPath).toLowerCase();
        if (ext === '.json') {
            res.setHeader('Content-Type', 'application/json');
            const content = fs.readFileSync(fullPath, 'utf-8');
            res.send(content);
        } else if (ext === '.md') {
            res.setHeader('Content-Type', 'text/plain');
            const content = fs.readFileSync(fullPath, 'utf-8');
            res.send(content);
        } else {
            res.sendFile(fullPath);
        }
    } catch (error) {
        console.error('读取文件时出错:', error);
        res.status(500).json({ error: '读取文件时出错' });
    }
});

// 提供用户目录下文件的直接访问
app.get('/user-data/:userName/*', (req, res) => {
    const { userName } = req.params;
    const filePath = req.params[0]; // 获取剩余的路径部分
    
    const fullPath = path.join(__dirname, '../data/SessionData', userName, filePath);
    
    console.log('请求用户文件路径:', fullPath);
    
    // 检查文件是否存在
    if (!fs.existsSync(fullPath)) {
        console.error('用户文件不存在:', fullPath);
        return res.status(404).json({ error: '文件不存在' });
    }
    
    try {
        // 根据文件扩展名设置正确的 Content-Type
        const ext = path.extname(fullPath).toLowerCase();
        if (ext === '.json') {
            res.setHeader('Content-Type', 'application/json');
            const content = fs.readFileSync(fullPath, 'utf-8');
            res.send(content);
        } else if (ext === '.md') {
            res.setHeader('Content-Type', 'text/plain');
            const content = fs.readFileSync(fullPath, 'utf-8');
            res.send(content);
        } else {
            res.sendFile(fullPath);
        }
    } catch (error) {
        console.error('读取用户文件时出错:', error);
        res.status(500).json({ error: '读取文件时出错' });
    }
});

// 列出目录内容
app.post('/list-directory', (req, res) => {
    const { userName, folderName } = req.body;
    
    if (!userName || !folderName) {
        return res.status(400).json({ error: 'userName and folderName are required' });
    }
    
    // 构建完整路径
    const fullPath = path.join(__dirname, '../data/SessionData', userName, folderName);
    
    console.log('列出目录:', fullPath);
    
    // 检查目录是否存在
    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: '目录不存在', files: [] });
    }
    
    try {
        const files = fs.readdirSync(fullPath).filter(file => {
            const filePath = path.join(fullPath, file);
            return fs.statSync(filePath).isFile();
        });
        
        res.json({ files });
    } catch (error) {
        console.error('读取目录时出错:', error);
        res.status(500).json({ error: '读取目录时出错', files: [] });
    }
});



app.post('/sessiondata/:taskId/drafts/latest.md', (req, res) => {
    const { taskId } = req.params;
    if (!taskId) {
        console.error('Missing taskId in request');
        return res.status(400).json({ error: 'Missing taskId' });
    }
    const { content } = req.body;

    console.log('Received taskId:', taskId); // Log taskId
    console.log('Received content:', content); // Log content
    if (!content) {
        return res.status(400).json({ error: 'Content is required' });
    }

    // Extract the username from the taskId
    const userName = taskId.split('_')[0];
    const filePath = path.join(__dirname, '../data/SessionData', userName, taskId, 'drafts', 'latest.md');
    console.log('Generated filePath:', filePath); // Log filePath

    try {
        // Ensure the drafts directory exists
        const draftsDir = path.dirname(filePath);
        if (!fs.existsSync(draftsDir)) {
            fs.mkdirSync(draftsDir, { recursive: true });
        }

        fs.writeFileSync(filePath, content, 'utf-8');
        // Log the content written to the file
        const writtenContent = fs.readFileSync(filePath, 'utf-8');
        console.log('Content written to file:', writtenContent);
        res.status(200).json({ message: 'Content saved successfully.' });
    } catch (error) {
        console.error('Error saving content to latest.md:', error);
        res.status(500).json({ error: 'Failed to save content.' });
    }
});



app.post('/content-expand', async (req, res) => {
    const { userName, taskId, selectedContent } = req.body;

    if (!userName || !taskId || !selectedContent) {
        return res.status(400).json({ error: 'userName, taskId, and selectedContent are required' });
    }

    try {
        // Load the prompt template
        const promptPath = path.join(__dirname, '../../public/data/Prompts/14extend.prompt.md');
        let promptTemplate;
        try {
            promptTemplate = fs.readFileSync(promptPath, 'utf-8');
        } catch (error) {
            console.error('Failed to load 14extend.prompt.md:', error);
            return res.status(500).json({ error: 'Failed to load prompt template' });
        }

        // Load draft latest and factor choices
        const draftPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'drafts', 'latest.md');
        const factorChoicesPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'factors', 'choices.json');
        
        let draftLatest = '';
        let factorChoices = {};
        
        try {
            draftLatest = fs.readFileSync(draftPath, 'utf-8');
        } catch (error) {
            console.warn('Could not load draft latest:', error);
        }
        
        try {
            factorChoices = JSON.parse(fs.readFileSync(factorChoicesPath, 'utf-8'));
        } catch (error) {
            console.warn('Could not load factor choices:', error);
        }

        // Replace placeholders in the prompt
        const prompt = promptTemplate
            .replace('{{DRAFT_LATEST}}', draftLatest)
            .replace('{{FACTOR_CHOICES}}', JSON.stringify(factorChoices, null, 2))
            .replace('{{SELECTED_CONTENT}}', selectedContent);

        const expandedContent = await sendRequestToGemini(prompt);

        if (!expandedContent) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        res.json({ expandedContent: expandedContent.trim() });
    } catch (error) {
        console.error('Error in content-expand:', error);
        res.status(500).json({ error: 'Error in content-expand: ' + error.message });
    }
});

app.post('/content-shorten', async (req, res) => {
    const { userName, taskId, selectedContent } = req.body;

    if (!userName || !taskId || !selectedContent) {
        return res.status(400).json({ error: 'userName, taskId, and selectedContent are required' });
    }

    try {
        // Load the prompt template
        const promptPath = path.join(__dirname, '../../public/data/Prompts/13shorten.prompt.md');
        let promptTemplate;
        try {
            promptTemplate = fs.readFileSync(promptPath, 'utf-8');
        } catch (error) {
            console.error('Failed to load 13shorten.prompt.md:', error);
            return res.status(500).json({ error: 'Failed to load prompt template' });
        }

        // Load draft latest and factor choices
        const draftPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'drafts', 'latest.md');
        const factorChoicesPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'factors', 'choices.json');
        
        let draftLatest = '';
        let factorChoices = {};
        
        try {
            draftLatest = fs.readFileSync(draftPath, 'utf-8');
        } catch (error) {
            console.warn('Could not load draft latest:', error);
        }
        
        try {
            factorChoices = JSON.parse(fs.readFileSync(factorChoicesPath, 'utf-8'));
        } catch (error) {
            console.warn('Could not load factor choices:', error);
        }

        // Replace placeholders in the prompt
        const prompt = promptTemplate
            .replace('{{DRAFT_LATEST}}', draftLatest)
            .replace('{{FACTOR_CHOICES}}', JSON.stringify(factorChoices, null, 2))
            .replace('{{SELECTED_CONTENT}}', selectedContent);

        const shortenedContent = await sendRequestToGemini(prompt);

        if (!shortenedContent) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        res.json({ shortenedContent: shortenedContent.trim() });
    } catch (error) {
        console.error('Error in content-shorten:', error);
        res.status(500).json({ error: 'Error in content-shorten: ' + error.message });
    }
});

// ... existing code ...

// ... existing code ...

// Save Manual Edit Tool 接口
app.post('/save-manual-edit-tool', async (req, res) => {
    const { userTask, userName, taskId, userEditReason, componentBeforeEdit, componentAfterEdit } = req.body;

    if (!userTask || !userName || !taskId || !userEditReason || !componentBeforeEdit || !componentAfterEdit) {
        return res.status(400).json({ error: 'Missing required fields in the request body' });
    }

    try {
        // Load factor choices from session data
        const factorChoicesPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'factors', 'choices.json');
        let factorChoices = {};
        if (fs.existsSync(factorChoicesPath)) {
            factorChoices = JSON.parse(fs.readFileSync(factorChoicesPath, 'utf-8'));
        }

        // Load latest draft from session data
        const draftLatestPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'drafts', 'latest.md');
        let draftLatest = '';
        if (fs.existsSync(draftLatestPath)) {
            draftLatest = fs.readFileSync(draftLatestPath, 'utf-8');
        }

        // Load prompt template
        const promptPath = path.join(__dirname, '../../public/data/Prompts/8manual_edit_analysis.prompt.md');
        let promptTemplate;
        try {
            promptTemplate = fs.readFileSync(promptPath, 'utf-8');
        } catch (error) {
            console.error('Failed to load 8manual_edit_analysis.prompt.md:', error);
            return res.status(500).json({ error: 'Failed to load prompt template' });
        }

        // Replace placeholders in the prompt
        const prompt = promptTemplate
            .replace('{{USER_TASK}}', userTask)
            .replace('{{FACTOR_CHOICES}}', JSON.stringify(factorChoices, null, 2))
            .replace('{{DRAFT_LATEST}}', draftLatest)
            .replace('{{USER_EDIT_REASON}}', userEditReason)
            .replace('{{COMPONENT_BEFORE_EDIT}}', JSON.stringify(componentBeforeEdit, null, 2))
            .replace('{{COMPONENT_AFTER_EDIT}}', JSON.stringify(componentAfterEdit, null, 2));

        // Send request to Gemini
        const responseText = await sendRequestToGemini(prompt);

        if (!responseText) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        // Parse the response
        const jsonContent = responseText.replace(/```json|```/g, '');
        const parsedData = JSON.parse(jsonContent);

        // Print the response data in the backend
        console.log('Manual Edit Analysis Response:', JSON.stringify(parsedData, null, 2));

        // Save to AdaptiveStylebook
        const stylebookPath = path.join(__dirname, '../data/SessionData', userName, 'AdaptiveStylebook', 'AdaptiveStylebook.json');
        let stylebook = { revision_records: [] };
        
        if (fs.existsSync(stylebookPath)) {
            try {
                stylebook = JSON.parse(fs.readFileSync(stylebookPath, 'utf-8'));
                if (!stylebook.revision_records) {
                    stylebook.revision_records = [];
                }
            } catch (error) {
                console.error('Error reading existing stylebook:', error);
                stylebook = { revision_records: [] };
            }
        }

        // Add new revision records
        if (parsedData.revision_records && Array.isArray(parsedData.revision_records)) {
            stylebook.revision_records.push(...parsedData.revision_records);
        }

        // Ensure directory exists
        const stylebookDir = path.dirname(stylebookPath);
        if (!fs.existsSync(stylebookDir)) {
            fs.mkdirSync(stylebookDir, { recursive: true });
        }

        // Save updated stylebook
        fs.writeFileSync(stylebookPath, JSON.stringify(stylebook, null, 2));
        console.log('Saved to AdaptiveStylebook:', stylebookPath);

        res.json(parsedData);
    } catch (error) {
        console.error('Error in Save Manual Edit Tool:', error);
        res.status(500).json({ error: 'Error in Save Manual Edit Tool: ' + error.message });
    }
});

// Regenerate Draft 接口
app.post('/regenerate-draft', async (req, res) => {
    const { taskId, userTask, factorChoices, intentCurrent, userName } = req.body;

    if (!taskId || !userTask || !factorChoices || !intentCurrent || !userName) {
        return res.status(400).json({ error: 'Missing required fields in the request body' });
    }

    const promptPath = path.join(__dirname, '../../public/data/Prompts/email_regenerator.prompt.md');
    const draftsPath = path.join(__dirname, '../public/data/SessionData', userName, taskId, 'drafts');
    const latestDraftPath = path.join(draftsPath, 'latest.md');

    let promptTemplate;
    try {
        // 读取 prompt 文件
        promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    } catch (error) {
        console.error('Failed to load email_regenerator.prompt.md:', error);
        return res.status(500).json({ error: 'Failed to load prompt template' });
    }

    // 替换占位符生成 prompt
    const prompt = promptTemplate
        .replace('{{USER_TASK}}', userTask)
        .replace('{{DRAFT_LATEST}}', fs.existsSync(latestDraftPath) ? fs.readFileSync(latestDraftPath, 'utf-8') : '')
        .replace('{{FACTOR_CHOICES}}', JSON.stringify(factorChoices, null, 2))
        .replace('{{INTENT_CURRENT}}', JSON.stringify(intentCurrent, null, 2))
        .replace('{{INTENT_HISTORY}}', '[]'); // 可扩展为实际历史记录

    try {
        // 调用 AI 服务生成草稿
        const draftContent = await sendRequestToGemini(prompt);

        if (!draftContent) {
            throw new Error('AI response is empty');
        }

        // 确保 drafts 目录存在
        if (!fs.existsSync(draftsPath)) {
            fs.mkdirSync(draftsPath, { recursive: true });
        }

        // 保存到 latest.md
        fs.writeFileSync(latestDraftPath, draftContent.trim(), 'utf-8');

        // 按次序创建类似 01_draft.md 的文件
        const draftFiles = fs.readdirSync(draftsPath).filter((file) => file.match(/^\d+_draft\.md$/));
        const nextDraftNumber = draftFiles.length + 1;
        const nextDraftPath = path.join(draftsPath, `${String(nextDraftNumber).padStart(2, '0')}_draft.md`);
        fs.writeFileSync(nextDraftPath, draftContent.trim(), 'utf-8');

        res.status(200).json({ message: 'Draft regenerated successfully.', draft: draftContent.trim() });
    } catch (error) {
        console.error('Error regenerating draft:', error);
        res.status(500).json({ error: 'Failed to regenerate draft.' });
    }
});

app.post('/generate-anchor-builder', async (req, res) => {
    const { userTask, userName, taskId } = req.body;

    if (!userTask || !userName || !taskId) {
        return res.status(400).json({ error: 'userTask, userName, and taskId are required' });
    }

    try {
        // Load the prompt template
        const promptPath = path.join(__dirname, '../../public/data/Prompts/10anchor_builder.prompt.md');
        let promptTemplate;
        try {
            promptTemplate = fs.readFileSync(promptPath, 'utf-8');
        } catch (error) {
            console.error('Failed to load 10anchor_builder.prompt.md:', error);
            return res.status(500).json({ error: 'Failed to load prompt template' });
        }

        // Load draft content
        const draftPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'drafts', 'latest.md');
        let draftContent = '';
        try {
            draftContent = fs.readFileSync(draftPath, 'utf-8');
        } catch (error) {
            console.error('Failed to load draft content:', error);
            return res.status(500).json({ error: 'Failed to load draft content' });
        }

        // Load current intents
        const intentsPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'intents', 'current.json');
        let currentIntents = [];
        try {
            const intentsContent = fs.readFileSync(intentsPath, 'utf-8');
            currentIntents = JSON.parse(intentsContent);
        } catch (error) {
            console.error('Failed to load current intents:', error);
            return res.status(500).json({ error: 'Failed to load current intents' });
        }

        // Replace placeholders in the prompt
        const prompt = promptTemplate
            .replace('{{ORIGINAL_TASK}}', userTask)
            .replace('{{DRAFT_LATEST}}', draftContent)
            .replace('{{INTENT_CURRENT}}', JSON.stringify(currentIntents, null, 2));

        // Send request to Gemini
        const responseText = await sendRequestToGemini(prompt);

        if (!responseText) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        res.json({ anchorData: responseText.trim() });
    } catch (error) {
        console.error('Error in generate-anchor-builder:', error);
        res.status(500).json({ error: 'Error generating anchor builder content: ' + error.message });
    }
});




app.get('/api/anchors/:userName', (req, res) => {
    const { userName } = req.params;
    const userPath = path.join(__dirname, '../public/data/SessionData', userName);

    if (!fs.existsSync(userPath)) {
        return res.status(404).json({ error: `User directory not found for ${userName}` });
    }

    try {
        const taskDirs = fs.readdirSync(userPath).filter((dir) => {
            const taskPath = path.join(userPath, dir);
            return fs.statSync(taskPath).isDirectory();
        });

        const aggregatedAnchors = { persona: {}, situation: {} };

        taskDirs.forEach((taskId) => {
            const anchorPath = path.join(userPath, taskId, 'anchors.json');
            if (fs.existsSync(anchorPath)) {
                try {
                    const anchorData = JSON.parse(fs.readFileSync(anchorPath, 'utf-8'));
                    if (anchorData.persona) {
                        Object.keys(anchorData.persona).forEach((key) => {
                            aggregatedAnchors.persona[key] = anchorData.persona[key];
                        });
                    }
                    if (anchorData.situation) {
                        Object.keys(anchorData.situation).forEach((key) => {
                            aggregatedAnchors.situation[key] = anchorData.situation[key];
                        });
                    }
                } catch (error) {
                    console.error(`Error reading or parsing ${anchorPath}:`, error);
                }
            }
        });

        res.json(aggregatedAnchors);
    } catch (error) {
        console.error('Error aggregating anchors:', error);
        res.status(500).json({ error: 'Failed to aggregate anchors.' });
    }
});



app.post('/component-extractor', async (req, res) => {
    const { taskId, userName } = req.body;

    if (!taskId || !userName) {
        return res.status(400).json({ error: 'Missing required fields: taskId or userName' });
    }

    const promptPath = path.join(__dirname, '../../public/data/Prompts/5component_extractor.prompt.md');
    const latestDraftPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'drafts', 'latest.md');

    let promptTemplate;
    try {
        promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    } catch (error) {
        console.error('Failed to load 5component_extractor.prompt.md:', error);
        return res.status(500).json({ error: 'Failed to load prompt template' });
    }

    let draftContent;
    try {
        if (fs.existsSync(latestDraftPath)) {
            draftContent = fs.readFileSync(latestDraftPath, 'utf-8').trim();
        } else {
            return res.status(404).json({ error: 'latest.md not found' });
        }
    } catch (error) {
        console.error('Failed to read latest.md:', error);
        return res.status(500).json({ error: 'Failed to read latest.md' });
    }

    const prompt = promptTemplate.replace('{{DRAFT_LATEST}}', draftContent);

    try {
        const responseText = await sendRequestToGemini(prompt);

        if (!responseText) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        console.log('Component Extractor Output:', responseText);
        res.json({ components: responseText });
    } catch (error) {
        console.error('Error in Component Extractor:', error);
        res.status(500).json({ error: 'Error in Component Extractor' });
    }
});

app.post('/intent-analyzer-new', async (req, res) => {
    const { userTask, userName, taskId } = req.body;

    if (!userTask || !userName || !taskId) {
        return res.status(400).json({ error: 'Missing required fields: userTask, userName, or taskId' });
    }

    const promptPath = path.join(__dirname, '../../public/data/Prompts/3intent_analyzer_prompt.md');
    const factorChoicesPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'factors', 'choices.json');
    const latestDraftPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'drafts', 'latest.md');
    const intentsPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'intents', 'current.json');

    let promptTemplate;
    try {
        promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    } catch (error) {
        console.error('Failed to load 3intent_analyzer_prompt.md:', error);
        return res.status(500).json({ error: 'Failed to load prompt template' });
    }

    let factorChoices;
    try {
        factorChoices = fs.readFileSync(factorChoicesPath, 'utf-8');
    } catch (error) {
        console.error('Failed to read factor choices:', error);
        return res.status(500).json({ error: 'Failed to read factor choices' });
    }

    let latestDraft;
    try {
        latestDraft = fs.readFileSync(latestDraftPath, 'utf-8');
    } catch (error) {
        console.error('Failed to read latest draft:', error);
        return res.status(500).json({ error: 'Failed to read latest draft' });
    }

    const prompt = promptTemplate
        .replace('{{USER_TASK}}', userTask)
        .replace('{{FACTOR_CHOICES}}', factorChoices)
        .replace('{{DRAFT_LATEST}}', latestDraft);

    try {
        const responseText = await sendRequestToGemini(prompt, { enableThinking: false });

        if (!responseText) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        console.log('Raw AI Response:', responseText);

        // Sanitize the response to extract valid JSON
        const sanitizedResponse = responseText.replace(/```json|```/g, '').trim();

        // Parse the sanitized response
        let parsedData;
        try {
            parsedData = JSON.parse(sanitizedResponse);
        } catch (error) {
            console.error('Failed to parse sanitized response as JSON:', sanitizedResponse, error);
            return res.status(500).json({ error: 'Failed to parse AI response as JSON' });
        }

        // Ensure the intents directory exists
        const intentsDir = path.dirname(intentsPath);
        if (!fs.existsSync(intentsDir)) {
            fs.mkdirSync(intentsDir, { recursive: true });
        }

        // Save the parsed data to current.json
        try {
            fs.writeFileSync(intentsPath, JSON.stringify(parsedData, null, 2), 'utf-8');
        } catch (error) {
            console.error('Failed to write to current.json:', error);
            return res.status(500).json({ error: 'Failed to save intents to current.json' });
        }

        res.json({ message: 'Intents saved successfully', intents: parsedData });
    } catch (error) {
        console.error('Error in Intent Analyzer New:', error);
        res.status(500).json({ error: 'Error in Intent Analyzer New' });
    }
});

// Persona Anchor Adaptation interface
app.post('/persona-anchor-adaptation', async (req, res) => {
    const { userName, userTask, selectedAnchor } = req.body;

    if (!userName || !userTask || !selectedAnchor) {
        return res.status(400).json({ error: 'userName, userTask, and selectedAnchor are required' });
    }

    try {
        // Load prompt template
        const promptPath = path.join(__dirname, '../../public/data/Prompts/1persona_anchor_adaptation.md');
        let promptTemplate;
        try {
            promptTemplate = fs.readFileSync(promptPath, 'utf-8');
        } catch (error) {
            console.error('Failed to load 1persona_anchor_adaptation.md:', error);
            return res.status(500).json({ error: 'Failed to load prompt template' });
        }

        // Get previous user task from selected anchor
        const previousUserTask = selectedAnchor.userTask || '';

        // Get previous persona factors from current.json based on userId
        const currentJsonPath = path.join(__dirname, '../data/SessionData', userName, 'intents', 'current.json');
        let previousPersonaFactors = [];
        try {
            if (fs.existsSync(currentJsonPath)) {
                const allFactors = JSON.parse(fs.readFileSync(currentJsonPath, 'utf-8'));
                // Filter factors for persona categories: "Relationship between sender and receiver", "Demography", "Risk Mitigation"
                previousPersonaFactors = allFactors.filter(factor => 
                    factor.Category === "Relationship between sender and receiver" ||
                    factor.Category === "Demography" ||
                    factor.Category === "Risk Mitigation"
                );
            }
        } catch (error) {
            console.warn('Could not load previous persona factors:', error);
        }

        // Replace placeholders in prompt
        const prompt = promptTemplate
            .replace('{{PREVIOUS_USER_TASK}}', previousUserTask)
            .replace('{{USER_TASK}}', userTask)
            .replace('{{PREVIOUS_PERSONA_FACTORS}}', JSON.stringify(previousPersonaFactors, null, 2));

        const responseText = await sendRequestToGemini(prompt);

        if (!responseText) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        // Parse JSON response
        const jsonContent = responseText.replace(/```json|```/g, '').trim();
        const parsedData = JSON.parse(jsonContent);

        res.json({ adaptedFactors: parsedData.adapted_factors || [] });
    } catch (error) {
        console.error('Error in persona-anchor-adaptation:', error);
        res.status(500).json({ error: 'Error in persona anchor adaptation: ' + error.message });
    }
});

// Situation Anchor Adaptation interface
app.post('/situation-anchor-adaptation', async (req, res) => {
    const { userName, userTask, selectedAnchor, defaultFactor } = req.body;

    if (!userName || !userTask || !selectedAnchor) {
        return res.status(400).json({ error: 'userName, userTask, and selectedAnchor are required' });
    }

    try {
        // Load prompt template
        const promptPath = path.join(__dirname, '../../public/data/Prompts/2situation_anchor_adaptation.md');
        let promptTemplate;
        try {
            promptTemplate = fs.readFileSync(promptPath, 'utf-8');
        } catch (error) {
            console.error('Failed to load 2situation_anchor_adaptation.md:', error);
            return res.status(500).json({ error: 'Failed to load prompt template' });
        }

        // Get previous user task from selected anchor
        const previousUserTask = selectedAnchor.userTask || '';

        // Get previous situation factors from current.json based on userId
        const currentJsonPath = path.join(__dirname, '../data/SessionData', userName, 'intents', 'current.json');
        let previousSituationFactors = [];
        try {
            if (fs.existsSync(currentJsonPath)) {
                const allFactors = JSON.parse(fs.readFileSync(currentJsonPath, 'utf-8'));
                // Filter factors for situation category: "Communication Context"
                previousSituationFactors = allFactors.filter(factor => 
                    factor.Category === "Communication Context"
                );
            }
        } catch (error) {
            console.warn('Could not load previous situation factors:', error);
        }

        // Replace placeholders in prompt
        const prompt = promptTemplate
            .replace('{{PREVIOUS_USER_TASK}}', previousUserTask)
            .replace('{{USER_TASK}}', userTask)
            .replace('{{PREVIOUS_SITUATION_FACTORS}}',defaultFactor)
            //.replace('{{PREVIOUS_SITUATION_FACTORS}}', JSON.stringify(previousSituationFactors, null, 2));

        const responseText = await sendRequestToGemini(prompt);

        if (!responseText) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        // Parse JSON response
        const jsonContent = responseText.replace(/```json|```/g, '').trim();
        const parsedData = JSON.parse(jsonContent);

        res.json({ adaptedFactors: parsedData.adapted_factors || [] });
    } catch (error) {
        console.error('Error in situation-anchor-adaptation:', error);
        res.status(500).json({ error: 'Error in situation anchor adaptation: ' + error.message });
    }
});

app.post('/component-intent-link', async (req, res) => {
    const { userName, taskId, componentList } = req.body;

    if (!userName || !taskId || !componentList) {
        return res.status(400).json({ error: 'Missing required fields: userName, taskId, or componentList' });
    }

    const promptPath = path.join(__dirname, '../../public/data/Prompts/6component_intent_link.prompt.md');
    const intentsPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'intents', 'current.json');

    let promptTemplate;
    try {
        promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    } catch (error) {
        console.error('Failed to load 6component_intent_link.prompt.md:', error);
        return res.status(500).json({ error: 'Failed to load prompt template' });
    }

    let intentCurrent;
    try {
        intentCurrent = fs.readFileSync(intentsPath, 'utf-8');
    } catch (error) {
        console.error('Failed to read current intents:', error);
        return res.status(500).json({ error: 'Failed to read current intents' });
    }

    const prompt = promptTemplate
        .replace('{{COMPONENT_LIST}}', JSON.stringify(componentList, null, 2))
        .replace('{{INTENT_CURRENT}}', intentCurrent);

    try {
        const responseText = await sendRequestToGemini(prompt);

        if (!responseText) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        console.log('Component-Intent Link Output:', responseText);
        const sanitizedResponse = responseText.replace(/```json|```/g, '').trim();
        console.log('Component-Intent Link Output:', sanitizedResponse);
        res.json({ links: JSON.parse(sanitizedResponse) });
    } catch (error) {
        console.error('Error in Component-Intent Link:', error);
        res.status(500).json({ error: 'Error in Component-Intent Link' });
    }
});

app.post('/regenerate-anchor', async (req, res) => {
    const { userName, taskId, anchorJsonPath, userPrompt, userTask } = req.body;

    if (!userName || !taskId || !anchorJsonPath || !userPrompt || !userTask) {
        return res.status(400).json({ error: 'userName, taskId, anchorJsonPath, userPrompt, and userTask are required' });
    }

    try {
        // Load the prompt template
        const promptPath = path.join(__dirname, '../../public/data/Prompts/11anchor_editor.prompt.md');
        const promptTemplate = fs.readFileSync(promptPath, 'utf-8');

        // Load current anchor data from the provided path
        // Extract filename and reconstruct proper path to avoid path duplication issues
        console.log('anchorJsonPath received:', anchorJsonPath);
        
        // Extract just the filename from the path (handles both forward and backward slashes)
        const filename = anchorJsonPath.split(/[\/\\]/).pop();
        console.log('extracted filename:', filename);
        
        // Determine anchor type from filename
        let anchorType;
        if (filename.includes('Persona')) {
            anchorType = 'PersonaAnchor';
        } else if (filename.includes('Situation')) {
            anchorType = 'SituationAnchor';
        } else {
            throw new Error('Could not determine anchor type from filename: ' + filename);
        }
        
        // Construct the proper path
        const fullAnchorPath = path.join(__dirname, '../data/SessionData', userName, anchorType, filename);
        console.log('constructed fullAnchorPath:', fullAnchorPath);
        
        let currentAnchor = {};
        if (fs.existsSync(fullAnchorPath)) {
            currentAnchor = JSON.parse(fs.readFileSync(fullAnchorPath, 'utf-8'));
        }

        // Load draft latest and intent current from the same user and taskId
        const draftPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'drafts', 'latest.md');
        const intentsPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'intents', 'current.json');
        
        const draftLatest = fs.existsSync(draftPath) ? fs.readFileSync(draftPath, 'utf-8') : '';
        const intentCurrent = fs.existsSync(intentsPath) ? JSON.parse(fs.readFileSync(intentsPath, 'utf-8')) : [];

        // Replace placeholders in the prompt
        const prompt = promptTemplate
            .replace('{{USER_TASK}}', userTask)
            .replace('{{DRAFT_LATEST}}', draftLatest)
            .replace('{{INTENT_CURRENT}}', JSON.stringify(intentCurrent, null, 2))
            .replace('{{CURRENT_ANCHOR}}', JSON.stringify(currentAnchor, null, 2))
            .replace('{{USER_PROMPT}}', userPrompt);

        // Send request to Gemini
        const responseText = await sendRequestToGemini(prompt);
        const jsonContent = responseText.replace(/```json|```/g, '').trim();
        const updatedAnchor = JSON.parse(jsonContent);

        // Add userTask and taskId to the updated anchor
        updatedAnchor.userTask = userTask;
        updatedAnchor.taskId = taskId;

        // Ensure the directory exists before writing the file
        const dir = path.dirname(fullAnchorPath);
        console.log('Directory to create:', dir);
        if (!fs.existsSync(dir)) {
            console.log('Creating directory:', dir);
            fs.mkdirSync(dir, { recursive: true });
        }

        // Save the updated anchor to the original path
        console.log('About to write to path:', fullAnchorPath);
        fs.writeFileSync(fullAnchorPath, JSON.stringify(updatedAnchor, null, 2));

        res.json({ message: 'Anchor regenerated successfully', updatedAnchor });
    } catch (error) {
        console.error('Error in regenerate-anchor:', error);
        res.status(500).json({ error: 'Error regenerating anchor: ' + error.message });
    }
});

app.post('/intent-change-rewriter', async (req, res) => {
    const {
        userTask,
        factorChoices,
        draftLatest,
        componentCurrent,
        intentSelected,
        intentOthers
    } = req.body;

    if (!userTask || !factorChoices || !draftLatest || !componentCurrent || !intentSelected || !intentOthers) {
        return res.status(400).json({ error: 'Missing required fields in the request body' });
    }

    const promptPath = path.join(__dirname, '../../public/data/Prompts/7intent_change_rewriter.prompt.md');
    let promptTemplate;
    try {
        promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    } catch (error) {
        console.error('Failed to load 7intent_change_rewriter.prompt.md:', error);
        return res.status(500).json({ error: 'Failed to load prompt template' });
    }

    const prompt = promptTemplate
        .replace('{{USER_TASK}}', userTask)
        .replace('{{FACTOR_CHOICES}}', JSON.stringify(factorChoices, null, 2))
        .replace('{{DRAFT_LATEST}}', draftLatest)
        .replace('{{COMPONENT_CURRENT}}', componentCurrent)
        .replace('{{INTENT_SELECTED}}', JSON.stringify(intentSelected, null, 2))
        .replace('{{INTENT_OTHERS}}', JSON.stringify(intentOthers, null, 2));

    try {
        const responseText = await sendRequestToGemini(prompt);

        if (!responseText) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        const sanitizedResponse = responseText.replace(/```json|```/g, '').trim();
        const parsedData = JSON.parse(sanitizedResponse);

        res.json(parsedData);
    } catch (error) {
        console.error('Error in Intent Change Rewriter:', error);
        res.status(500).json({ error: 'Error in Intent Change Rewriter' });
    }
});


app.post('/ai-generate-rewrite', async (req, res) => {
    const { userTask, userName, taskId, selectedContent, userPrompt } = req.body;

    if (!userTask || !userName || !taskId || !selectedContent || !userPrompt) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Load the prompt template
        const promptPath = path.join(__dirname, '../../public/data/Prompts/15prompt_AI_rewrite.prompt.md');
        const promptTemplate = fs.readFileSync(promptPath, 'utf-8');

        // Load draft latest
        const draftPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'drafts', 'latest.md');
        const draftLatest = fs.existsSync(draftPath) ? fs.readFileSync(draftPath, 'utf-8') : '';

        // Load factor choices
        const factorChoicesPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'factors', 'choices.json');
        const factorChoices = fs.existsSync(factorChoicesPath) ? JSON.parse(fs.readFileSync(factorChoicesPath, 'utf-8')) : {};

        // Replace placeholders in the prompt
        const prompt = promptTemplate
            .replace('{{USER_TASK}}', userTask)
            .replace('{{DRAFT_LATEST}}', draftLatest)
            .replace('{{FACTOR_CHOICES}}', JSON.stringify(factorChoices, null, 2))
            .replace('{{SELECTED_CONTENT}}', selectedContent)
            .replace('{{USER_PROMPT}}', userPrompt);

        // Call Gemini API
        const rewrittenContent = await sendRequestToGemini(prompt);

        if (!rewrittenContent) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        res.json({ rewrittenContent: rewrittenContent.trim() });
    } catch (error) {
        console.error('Error in AI generate rewrite:', error);
        res.status(500).json({ error: 'Error generating rewrite: ' + error.message });
    }
});

app.post('/stylebook-recommend', async (req, res) => {
    const { userTask, userName, taskId, selectedContent } = req.body;

    if (!userTask || !userName || !taskId || !selectedContent) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Load the prompt template
        const promptPath = path.join(__dirname, '../../public/data/Prompts/9stylebook_recommended_revision.prompt.md');
        let promptTemplate;
        try {
            promptTemplate = fs.readFileSync(promptPath, 'utf-8');
        } catch (error) {
            console.error('Failed to load stylebook prompt:', error);
            return res.status(500).json({ error: 'Failed to load prompt template' });
        }

        // Load factor choices
        const factorChoicesPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'factors', 'choices.json');
        let factorChoices = [];
        if (fs.existsSync(factorChoicesPath)) {
            factorChoices = JSON.parse(fs.readFileSync(factorChoicesPath, 'utf-8'));
        }

        // Load adaptive stylebook
        const stylebookPath = path.join(__dirname, '../data/SessionData', userName, 'AdaptiveStylebook', 'AdaptiveStylebook.json');
        let adaptiveStylebook = {};
        if (fs.existsSync(stylebookPath)) {
            adaptiveStylebook = JSON.parse(fs.readFileSync(stylebookPath, 'utf-8'));
        }
        // Load draft latest
        const draftLatestPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'drafts', 'latest.md');
        let draftLatest = '';
        try {
            draftLatest = fs.readFileSync(draftLatestPath, 'utf-8');
        } catch (error) {
            console.error('Failed to read latest draft:', error);
            return res.status(500).json({ error: 'Failed to read latest draft' });
        }
        // Replace placeholders in the prompt
        const prompt = promptTemplate
            .replace('{{USER_TASK}}', userTask)
            .replace('{{DRAFT_LATEST}}', draftLatest)
            .replace('{{SELECTED_CONTENT}}', selectedContent)
            .replace('{{ADAPTIVE_STYLEBOOK}}', JSON.stringify(adaptiveStylebook, null, 2));

        // Send request to Gemini
        const responseText = await sendRequestToGemini(prompt);

        if (!responseText) {
            return res.status(500).json({ error: 'AI response is empty' });
        }

        // Handle "NA" response
        if (responseText.trim() === 'NA') {
            return res.json({ recommendations: [] });
        }

        // Parse JSON response
        const jsonContent = responseText.replace(/```json|```/g, '');
        const recommendations = JSON.parse(jsonContent);

        res.json({ recommendations });
    } catch (error) {
        console.error('Error in stylebook recommend:', error);
        res.status(500).json({ error: 'Error generating stylebook recommendations' });
    }
});

// 更新任务元数据接口
app.post('/update-task-meta', (req, res) => {
    const { userName, taskId, originalTask } = req.body;

    if (!userName || !taskId || originalTask === undefined) {
        return res.status(400).json({ error: 'userName, taskId, and originalTask are required' });
    }

    const taskMetaPath = path.join(__dirname, '../data/SessionData', userName, taskId, 'meta', 'task.json');

    try {
        // 读取现有的 task.json
        let taskMeta = {};
        if (fs.existsSync(taskMetaPath)) {
            taskMeta = JSON.parse(fs.readFileSync(taskMetaPath, 'utf-8'));
        }

        // 更新 original_task 字段
        taskMeta.original_task = originalTask;

        // 确保目录存在
        const metaDir = path.dirname(taskMetaPath);
        if (!fs.existsSync(metaDir)) {
            fs.mkdirSync(metaDir, { recursive: true });
        }

        // 写入更新后的内容
        fs.writeFileSync(taskMetaPath, JSON.stringify(taskMeta, null, 2));
        
        res.status(200).json({ message: 'Task meta updated successfully' });
    } catch (error) {
        console.error('Error updating task meta:', error);
        res.status(500).json({ error: 'Error updating task meta' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});