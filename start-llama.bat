@echo off
set LLAMA_EXE=C:\llm\bin\llama-server.exe
set MODEL_PATH=C:\llm\model.gguf

if not exist "%LLAMA_EXE%" (
    echo HATA: llama-server.exe bulunamadi: %LLAMA_EXE%
    pause
    exit /b 1
)

if not exist "%MODEL_PATH%" (
    echo HATA: Model dosyasi bulunamadi: %MODEL_PATH%
    pause
    exit /b 1
)

echo DikDur AI Modeli baslatiliyor...
echo Model: %MODEL_PATH%
echo Port: 8080
echo.

"%LLAMA_EXE%" -m "%MODEL_PATH%" --port 8080 --host 0.0.0.0 -c 4096 --log-disable
