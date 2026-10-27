"""One validated set of production controls for model, imported and demo jobs."""
DURATIONS=(2,5,10,15,20,30,60,120,180,300)

def settings(data,duration=None):
    duration=data.get('duration',10) if duration is None else duration
    if type(duration) is not int or duration not in DURATIONS:raise ValueError('Unsupported duration.')
    quality=data.get('quality','studio')
    if quality not in ('preview','studio','ultra'):raise ValueError('Unsupported quality.')
    aspect=data.get('aspect','16:9')
    if aspect not in ('16:9','9:16','1:1','4:3'):raise ValueError('Unsupported aspect ratio.')
    fps=data.get('fps',24)
    if type(fps) is not int or fps not in (24,30,60):raise ValueError('Frame rate must be 24, 30 or 60.')
    reviews=data.get('reviews',3)
    if type(reviews) is not int or not 0<=reviews<=5:raise ValueError('Visual review budget must be 0..5.')
    detail=data.get('detail','cinematic')
    if detail not in ('cinematic','concept'):raise ValueError('Unsupported detail level.')
    style=data.get('style','auto')
    if style not in ('auto','cinematic','stylized','technical','product'):raise ValueError('Unsupported visual style.')
    engine=data.get('engine','eevee')
    if engine not in ('eevee','cycles'):raise ValueError('Unsupported renderer.')
    narration=data.get('narration','')
    if not isinstance(narration,str) or len(narration)>8000:raise ValueError('Narration must be at most 8,000 characters')
    voice=data.get('voice')
    if narration.strip():
        from speech import validate_voice
        validate_voice(voice)
    rate=data.get('speech_rate',170)
    if type(rate) is not int or not 100<=rate<=260:raise ValueError('Speech rate must be 100..260 words/minute')
    audio=data.get('audio_id')
    if audio:
        from asset_library import get
        get(audio,'audio')
    volume=data.get('audio_volume',.35)
    if isinstance(volume,bool) or not isinstance(volume,(int,float)) or not 0<=volume<=2:raise ValueError('Audio volume must be between 0 and 2')
    base={'preview':1280,'studio':1920,'ultra':3840}[quality]
    a,b=map(int,aspect.split(':'));width=base if a>=b else round(base*a/b);height=round(base*b/a) if a>=b else base
    width=round(width/2)*2;height=round(height/2)*2
    return {'duration':duration,'width':width,'height':height,'fps':fps,'samples':{'preview':32,'studio':64,'ultra':128}[quality],
            'reviews':reviews,'quality':quality,'engine':engine,'aspect':aspect,'detail':detail,'style':style,
            'narration':narration.strip(),'voice':voice,'speech_rate':rate,'audio_id':audio,'audio_volume':volume}
