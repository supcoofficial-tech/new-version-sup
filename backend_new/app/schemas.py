from pydantic import BaseModel

class AgentBase(BaseModel):
    name: str
    role: str

class AgentCreate(AgentBase):
    pass

class Agent(AgentBase):
    id: int

    class Config:
        orm_mode = True
